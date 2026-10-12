const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const password = crypto.randomBytes(24).toString('hex');
process.env.ADMIN_PASSWORD = password;
process.env.TEAM_1_PASSWORD = password;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'varso-test-'));
process.env.DATA_DIR = directory;
const app = require('../server');
let server, url;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(directory, { recursive:true, force:true });
});
function post(route, body, token) {
  return fetch(url + route, { method:'POST', headers:{'Content-Type':'application/json', ...(token ? {Authorization:`Bearer ${token}`} : {})}, body:JSON.stringify(body) });
}
test('server enforces credentials and team ownership before state changes', async () => {
  assert.equal((await post('/api/game-data', {})).status, 401);
  assert.equal((await post('/api/reset-game', {})).status, 401);
  assert.equal((await post('/api/login', {role:'admin'})).status, 401);
  const admin = (await (await post('/api/login', {role:'admin', password})).json()).token;
  const team = id => ({name:`Team ${id}`, completedStations:{1:10}, bingoMarked:{}, bingoPhotos:{}, totalPoints:10});
  assert.equal((await post('/api/game-data', {1:team(1),2:team(2)}, admin)).status, 200);
  const token = (await (await post('/api/login', {role:'team', teamId:1, password})).json()).token;
  assert.equal((await post('/api/game-data', {1:{bingoMarked:{0:true}, completedStations:{1:9999}},2:{bingoMarked:{0:true}}}, token)).status, 200);
  const data = await (await fetch(url+'/api/game-data')).json();
  assert.equal(data[1].completedStations[1], 10);
  assert.equal(data[1].totalPoints, 11);
  assert.deepEqual(data[2].bingoMarked, {});
  assert.equal((await post('/api/upload-bingo/2/0', {}, token)).status, 403);
  assert.equal((await post('/api/upload-bingo/../0', {}, token)).status, 404);
  assert.equal((await post('/api/reset-game', {}, token)).status, 403);
  assert.equal((await post('/api/validate-station', {stationId:1,teamId:1,points:10})).status, 401);
});
