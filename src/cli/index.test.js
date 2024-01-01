const fs = require('fs')
const path = require('path')
const cp = require('child_process')
const assert = require('assert')
const supertest = require('supertest')
const osTmpdir = require('os-tmpdir')
const tempWrite = require('temp-write')
const mkdirp = require('mkdirp')
const rimraf = require('rimraf')
const _serverReady = require('server-ready')
const {promisify} = require('util')

let PORT = 3100

const serverReady = promisify(_serverReady)

const middlewareFiles = {
  en: './../../__fixtures__/middlewares/en.js',
  jp: './../../__fixtures__/middlewares/jp.js',
  postbody: './../../__fixtures__/middlewares/postbody.js',
}

const bin = path.join(__dirname, '../../lib/cli/bin')

function cli(args) {
  return cp.spawn('node', ['--', bin, '-p', PORT].concat(args), {
    cwd: __dirname,
    stdio: ['pipe', process.stdout, process.stderr],
  })
}

describe('cli', () => {
  let child
  let request
  let dbFile
  let routesFile

  beforeEach(() => {
    dbFile = tempWrite.sync(
      JSON.stringify({
        posts: [{id: 1}, {_id: 2}],
        comments: [{id: 1, post_id: 1}],
      }),
      'db.json',
    )

    routesFile = tempWrite.sync(
      JSON.stringify({'/blog/*': '/$1'}),
      'routes.json',
    )

    ++PORT
    request = supertest(`http://localhost:${PORT}`)
  })

  afterEach(() => {
    child.kill('SIGKILL')
  })

  describe('db.json', () => {
    beforeEach(() => {
      child = cli([dbFile])
      return serverReady(PORT)
    })

    test('should support JSON file', () => {
      return request.get('/posts').expect(200)
    })

    test('should send CORS headers', () => {
      const origin = 'http://example.com'

      return request
        .get('/posts')
        .set('Origin', origin)
        .expect('access-control-allow-origin', origin)
        .expect(200)
    })

    test('should update JSON file', (done) => {
      request
        .post('/posts')
        .send({title: 'hello'})
        .end(() => {
          setTimeout(() => {
            const str = fs.readFileSync(dbFile, 'utf8')
            assert(str.indexOf('hello') !== -1)
            done()
          }, 1000)
        })
    })
  })

  describe('seed.js', () => {
    beforeEach(() => {
      child = cli(['../../__fixtures__/seed.js'])
      return serverReady(PORT)
    })

    test('should support JS file', () => {
      return request.get('/posts').expect(200)
    })
  })

  describe('seed.cjs', () => {
    beforeEach(() => {
      child = cli(['../../__fixtures__/seed.cjs'])
      return serverReady(PORT)
    })

    test('should support CommonJS file', () => {
      return request.get('/posts').expect(200)
    })
  })

  describe('remote db', () => {
    beforeEach(() => {
      child = cli(['https://jsonplaceholder.typicode.com/db'])
      return serverReady(PORT)
    })

    test('should support URL file', () => {
      return request.get('/posts').expect(200)
    })
  })

  describe('db.json -r routes.json -m middleware.js -i _id --foreignKeySuffix _id --read-only', () => {
    beforeEach(() => {
      child = cli([
        dbFile,
        '-r',
        routesFile,
        '-m',
        middlewareFiles.en,
        '-i',
        '_id',
        '--read-only',
        '--foreignKeySuffix',
        '_id',
      ])
      return serverReady(PORT)
    })

    test('should use routes.json and _id as the identifier', () => {
      return request.get('/blog/posts/2').expect(200)
    })

    test('should use _id as foreignKeySuffix', async () => {
      const response = await request.get('/posts/1/comments')
      assert.strictEqual(response.body.length, 1)
    })

    test('should apply middlewares', () => {
      return request.get('/blog/posts/2').expect('X-Hello', 'World')
    })

    test('should allow only GET requests', () => {
      return request.post('/blog/posts').expect(403)
    })
  })

  describe('db.json -m first-middleware.js second-middleware.js', () => {
    beforeEach(() => {
      child = cli([dbFile, '-m', middlewareFiles.en, middlewareFiles.jp])
      return serverReady(PORT)
    })

    test('should apply all middlewares', () => {
      return request
        .get('/posts')
        .expect('X-Hello', 'World')
        .expect('X-Konnichiwa', 'Sekai')
    })
  })

  describe('db.json -m postbody-middleware.js', () => {
    beforeEach(() => {
      child = cli([dbFile, '-m', middlewareFiles.postbody])
      return serverReady(PORT)
    })

    test('should have post body in middleware', () => {
      return request.post('/posts').send({name: 'test'}).expect('name', 'test')
    })
  })

  describe('db.json -d 1000', () => {
    beforeEach(() => {
      child = cli([dbFile, '-d', 1000])
      return serverReady(PORT)
    })

    test('should delay response', (done) => {
      const start = new Date()
      request.get('/posts').expect(200, function (err) {
        const end = new Date()
        done(end - start > 1000 ? err : new Error("Request wasn't delayed"))
      })
    })
  })

  describe('db.json -s ../../__fixtures__/public -S /some/path/snapshots', () => {
    const snapshotsDir = path.join(osTmpdir(), 'snapshots')
    const publicDir = '../../__fixtures__/public'

    beforeEach((done) => {
      rimraf.sync(snapshotsDir)
      mkdirp.sync(snapshotsDir)

      child = cli([dbFile, '-s', publicDir, '-S', snapshotsDir])
      serverReady(PORT, () => {
        child.stdin.write('s\n')
        setTimeout(done, 100)
      })
    })

    test('should serve ../../__fixtures__/public', () => {
      return request.get('/').expect(/Hello/)
    })

    test('should save a snapshot in snapshots dir', () => {
      assert.strictEqual(fs.readdirSync(snapshotsDir).length, 1)
    })
  })

  describe('../../__fixtures__/seed.json --no-cors=true', () => {
    beforeEach(() => {
      child = cli(['../../__fixtures__/seed.js', '--no-cors=true'])
      return serverReady(PORT)
    })

    test('should not send Access-Control-Allow-Origin headers', (done) => {
      const origin = 'http://example.com'

      request
        .get('/posts')
        .set('Origin', origin)
        .expect(200)
        .end((err, res) => {
          if (err) {
            done(err)
          }
          if ('access-control-allow-origin' in res.headers) {
            done(new Error('CORS headers were not excluded from response'))
          } else {
            done()
          }
        })
    })
  })

  describe('../../__fixtures__/seed.json --no-gzip=true', () => {
    beforeEach(() => {
      child = cli(['../../__fixtures__/seed.js', '--no-gzip=true'])
      return serverReady(PORT)
    })

    test('should not set Content-Encoding to gzip', (done) => {
      request
        .get('/posts')
        .expect(200)
        .end(function (err, res) {
          if (err) {
            done(err)
          } else if ('content-encoding' in res.headers) {
            done(new Error('Content-Encoding is set to gzip'))
          } else {
            done()
          }
        })
    })
  })

  describe('--watch db.json -r routes.json', () => {
    beforeEach(() => {
      child = cli([dbFile, '-r', routesFile, '--watch'])
      return serverReady(PORT)
    })

    test('should watch db file', (done) => {
      fs.writeFileSync(dbFile, JSON.stringify({foo: []}))
      setTimeout(() => {
        request.get('/foo').expect(200, done)
      }, 1000)
    })

    test('should watch routes file', (done) => {
      fs.writeFileSync(routesFile, JSON.stringify({'/api/*': '/$1'}))
      setTimeout(() => {
        request.get('/api/posts').expect(200, done)
      }, 1000)
    })
  })

  describe('non existent db.json', () => {
    beforeEach(() => {
      fs.unlinkSync(dbFile)
      child = cli([dbFile])
      return serverReady(PORT)
    })

    test("should create JSON file if it doesn't exist", () => {
      return request.get('/posts').expect(200)
    })
  })

  describe('db.json with error', () => {
    beforeEach(() => {
      dbFile = tempWrite.sync(JSON.stringify({'a/b': []}), 'db-error.json')
    })

    test('should exit with an error', (done) => {
      child = cli([dbFile])
      child.on('exit', (code) => {
        if (code === 1) {
          return done()
        }
        return done(new Error('should exit with error code'))
      })
    })
  })
})
