const { EOL } = require('os')
const childProcess = require('child_process')

const CR = '\r'.charCodeAt(0)
const LF = '\n'.charCodeAt(0)
const CRLF = Buffer.from('\r\n')

class DeferredTask {
  constructor () {
    this.promise = new Promise((resolve, reject) => {
      this._resolve = resolve
      this._reject = reject
    })
  }

  resolve (value) {
    this._resolve(value)
  }

  reject (reason) {
    this._reject(reason)
  }

  start () { }
}

class MeCabReadTask extends DeferredTask {
  constructor (mecab, lineBreaks, optDecoder = null) {
    super()
    this._mecab = mecab
    this._result = []
    this._lastBuffer = null
    this._maxEos = lineBreaks
    this._eosCount = 0
    this._eosSample = mecab.getEOSSample()
    this._decoder = optDecoder
    this._eosObject = mecab.getEOSObject()
  }

  _concatBuffer (data) {
    if (this._lastBuffer === null) {
      return data
    }
    // TODO:  Do not concat, It must be more faster.
    const buffer = Buffer.concat([this._lastBuffer, data])
    this._lastBuffer = null
    return buffer
  }

  readData (mecab, data) {
    const buffer = this._concatBuffer(data)

    let offset = 0
    while (offset < buffer.length) {
      const index = buffer.indexOf(this._eosSample, offset)
      if (index === -1) {
        this._lastBuffer = buffer.slice(offset)
        break
      } else {
        const sentence = this._decoder
          ? this._decoder(buffer.slice(offset, index)).toString('utf8')
          : buffer.toString('utf8', offset, index)
        if (sentence !== '') {
          this._parseSentence(mecab, sentence)
        }
        this._eosCount++
        if (this._eosCount === this._maxEos) {
          this.resolve(this._result)
          return true
        }
        this._result.push(this._eosObject)
        offset = index + this._eosSample.length
      }
    }
    return false
  }

  _parseSentence (mecab, sentence) {
    const parse = mecab.lineParser
    let offset = 0
    while (offset < sentence.length) {
      const index = sentence.indexOf(EOL, offset)
      if (index > -1) {
        const line = sentence.substring(offset, index)
        this._result.push(parse(line))
        offset = index + EOL.length
      } else {
        break
      }
    }
  }
}

class MeCabKillTask extends DeferredTask {
  constructor (mecab, signal) {
    super()
    this._mecab = mecab
    this._signal = signal
  }

  /**
   * @override
   */
  start () {
    this._mecab._process.kill(this._signal)
  }
}

/**
 * Mecab process class.
 */
class MeCab {
  /**
   *
   * @param {string} command - a command.
   * @param {Array} optArgv - command arguments.
   * @param {Object} optOptions - process options.
   */
  constructor (command, optArgv, optOptions) {
    this._encoder = null
    this._decoder = null
    this.setEOSSample('EOS\\n')
    this.setEOSObject('EOS')
    this.lineParser = this.createLineParser(/[\t,]/)
    this._tasks = []
    this._process = childProcess.spawn(command, optArgv, optOptions)
    this._process.stdout.on('data', data => {
      const task = this._tasks[0]
      if (task.readData(this, data)) {
        this._tasks.shift()
        if (this._tasks.length > 0) {
          this._tasks[0].start()
        }
      }
    })
    this._process.on('close', code => {
      this._tasks.forEach(task => {
        if (code) {
          task.reject(`MeCab process crushed. code:${code}`)
        } else if (task instanceof MeCabReadTask) {
          task.reject('MeCab process is killed.')
        } else {
          task.resolve('MeCab process is killed.')
        }
      })
    })
    this._process.on('error', error => {
      this._rejectAllTasks(error)
    })
  }

  /**
   * Analyze Mophemes.
   * @param {Object} obj - an input text string or Buffer.
   * @param {function} optEncoder - encoder function or null.
   * @param {function} optDecoder - decoder function or null.
   * @returns {Promise} this is Promise return an array of morphemes.
   */
  async analyze (obj, optEncoder = null, optDecoder = null) {
    let buffer = typeof (obj) === 'string' ? Buffer.from(obj) : obj
    if (optEncoder) {
      buffer = optEncoder(buffer)
    } else if (this._encoder) {
      buffer = this._encoder(buffer)
    }
    const lineBreaks = this._countSentences(buffer)
    const decoder = optDecoder || this._decoder
    const task = new MeCabReadTask(this, lineBreaks + 1, decoder)
    this._addTask(task)
    const stdin = this._process.stdin
    stdin.write(buffer)
    stdin.write(EOL)
    return task.promise
  }

  /**
   * Kill a MeCab process.
   * @param {boolean} optForce - if value is true, kill the process without waiting for the task to finish.
   * @param {string} optSignal - kill signal string. default value is 'SIGTERM'.
   * @returns {Promise} return a message string when MeCab's process is killed.
   */
  async kill (optForce = false, optSignal = 'SIGTERM') {
    if (optForce) {
      this._rejectAllTasks('The process was interrupted immediately.')
    }
    return this._addTask(new MeCabKillTask(this, optSignal)).promise
  }

  /**
   * @param {function} encoder - encoder function or null.
   */
  setDefaultEncoder (encoder) {
    this._encoder = encoder
  }

  /**
   * @param {function} decoder - decoder function or null.
   */
  setDefaultDecoder (decoder) {
    this._decoder = decoder
  }

  /**
   * @param {Object} sample - eos format string or Buffer.
   */
  setEOSSample (sample) {
    if (typeof(sample) === 'string') {
      this._eosSample = Buffer.from(sample.replace('\\n', EOL))
    } else {
      this._eosSample = sample
    }
  }

  /**
   * @returns {Object} - return eos sample.
   */
  getEOSSample () {
    return this._eosSample
  }

  /**
   * @param {Object} obj - eos object.
   */
  setEOSObject (obj) {
    this._eosObject = obj
  }

  /**
   * @returns {Object} - return a eos object.
   */
  getEOSObject () {
    return this._eosObject
  }

  /**
   * @param {Object} sep - separater string or RegExp.
   * @returns {function} - return a parsed object.
   */
  createLineParser (sep) {
    return line => line.split(sep)
  }

  /**
   * @returns {ChildProcess} - return a child process.
   */
  getProcess () {
    return this._process
  }

  _addTask (task) {
    this._tasks.push(task)
    if (this._tasks.length === 1) {
      task.start()
    }
    return task
  }

  _countSentences (buffer) {
    let lb = 0
    let offset = 0
    let count = 0
    // Detect the line breaking type.
    for (let i = 0; i < buffer.length; i++) {
      offset = i
      const byte = buffer[i]
      if (byte === LF) {
        lb = byte
        count++
        break
      } else if (byte === CR) {
        if (i + 1 < buffer.length && buffer[i + 1] === LF) {
          lb = CRLF
          offset++
        } else {
          lb = CR
        }
        count++
        break
      }
    }
    if (count === 0) {
      return 0
    }
    // Count all line breaks.
    const lbBytes = lb === CRLF ? 2 : 1
    offset++
    while (offset < buffer.length) {
      const index = buffer.indexOf(lb, offset)
      if (index > -1) {
        count++
        offset = index + lbBytes
      } else {
        break
      }
    }
    return count
  }

  _rejectAllTasks (reason) {
    this._tasks.forEach(task => {
      task.reject(reason)
    })
    this._tasks = []
  }
}

/**
 *
 * @param {string} optCommand - a command.
 * @param {Array} optArgv - command arguments.
 * @param {Object} optOptions - process options.
 */
function spawn (optCommand = 'mecab', optArgv, optOptions) {
  return new MeCab(optCommand, optArgv, optOptions)
}

module.exports = {
  MeCab: MeCab,
  spawn: spawn
}
