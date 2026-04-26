var http = require('http');

function req(method, path, body, headers) {
  headers = headers || {};
  return new Promise(function(resolve, reject) {
    var data = body ? JSON.stringify(body) : null;
    var opts = { hostname: '127.0.0.1', port: 3000, path: path, method: method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers) };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    var r = http.request(opts, function(res) {
      var d = ''; res.on('data', function(c) { d += c; });
      res.on('end', function() { try { resolve({ status: res.statusCode, data: JSON.parse(d) }); } catch(e) { resolve({ status: res.statusCode, data: d }); } });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

var passed = 0;
var failed = 0;

function check(name, condition) {
  if (condition) { passed++; console.log('  PASS: ' + name); }
  else { failed++; console.log('  FAIL: ' + name); }
}

async function test() {
  var AP = '/ctrl-panel-9v7k2m';

  // 1. Register users
  console.log('=== 1. Register users ===');
  var r1 = await req('POST', '/api/bank/register', { fullName: 'Alice Johnson', username: 'alice', password: 'alice123' });
  check('Alice registered', r1.status === 201);
  var aliceToken = r1.data.token;

  var r2 = await req('POST', '/api/bank/register', { fullName: 'Bob Smith', username: 'bob', password: 'bob12345' });
  check('Bob registered', r2.status === 201);

  // 2. Admin login and fund
  console.log('=== 2. Admin funds Alice ===');
  var login = await req('POST', AP + '/api/login', { username: 'admin1', password: 'Ship@Secure01' });
  check('Admin login', login.status === 200);
  var adminAuth = { Authorization: 'Bearer ' + login.data.token };
  var users = await req('GET', AP + '/api/bank/users', null, adminAuth);
  var aliceId = users.data.find(function(u) { return u.username === 'alice'; }).id;
  var fund = await req('POST', AP + '/api/bank/users/' + aliceId + '/fund', { amount: 1000000, note: 'Big deposit' }, adminAuth);
  check('Fund result', fund.data.newBalance === 1000000);

  // 3. Check balance formatting (server returns number, client formats)
  console.log('=== 3. Check balance ===');
  var acct = await req('GET', '/api/bank/account', null, { Authorization: 'Bearer ' + aliceToken });
  check('Balance is 1000000', acct.data.balance === 1000000);

  // 4. Transfer
  console.log('=== 4. Transfer ===');
  var tx = await req('POST', '/api/bank/transfer', { recipientUsername: 'bob', amount: 50000.50, note: 'test' }, { Authorization: 'Bearer ' + aliceToken });
  check('Transfer OK', tx.status === 200);
  check('New balance', tx.data.newBalance === 949999.50);

  // 5. Tracking still works with new THB prefix
  console.log('=== 5. Tracking with THB prefix ===');
  var ship = await req('POST', AP + '/api/shipments', {
    senderName: 'Test', receiverName: 'Test2', originAddress: 'NYC', receiverAddress: 'LA',
    packageDescription: 'Box', packageType: 'Parcel', weight: '1', quantity: 1,
    originCoords: { lat: 40.7, lng: -74.0 }, destCoords: { lat: 34.0, lng: -118.2 }
  }, adminAuth);
  check('Shipment created', ship.status === 201);
  check('THB prefix', ship.data.trackingNumber.startsWith('THB-'));
  var track = await req('GET', '/api/track?tn=' + ship.data.trackingNumber);
  check('Track works', track.status === 200);

  // 6. Bank chat - user sends message
  console.log('=== 6. Bank chat - user sends message ===');
  var chatSend = await req('POST', '/api/bank/chat/send', { text: 'Hello admin, I need help with my account' }, { Authorization: 'Bearer ' + aliceToken });
  check('User chat sent', chatSend.status === 200 && chatSend.data.success);

  // 7. Bank chat - user sends image message
  console.log('=== 7. Bank chat - user sends image ===');
  var imgSend = await req('POST', '/api/bank/chat/send', { text: 'Here is my screenshot', imageData: 'data:image/png;base64,fakedata', imageName: 'screenshot.png' }, { Authorization: 'Bearer ' + aliceToken });
  check('User image sent', imgSend.status === 200 && imgSend.data.success);

  // 8. Bank chat - user gets their messages
  console.log('=== 8. Bank chat - user gets messages ===');
  var userMsgs = await req('GET', '/api/bank/chat/messages', null, { Authorization: 'Bearer ' + aliceToken });
  check('User has 2 messages', userMsgs.data.length === 2);
  check('First message text', userMsgs.data[0].text === 'Hello admin, I need help with my account');
  check('Second has image', userMsgs.data[1].imageData !== null);

  // 9. Admin gets chat conversations list
  console.log('=== 9. Admin gets chat list ===');
  var chatList = await req('GET', AP + '/api/bank/chats', null, adminAuth);
  check('One conversation', chatList.data.length === 1);
  check('Conversation is Alice', chatList.data[0].username === 'alice');
  check('2 unread', chatList.data[0].unreadCount === 2);

  // 10. Admin gets Alice's messages
  console.log('=== 10. Admin reads Alice messages ===');
  var adminMsgs = await req('GET', AP + '/api/bank/chats/' + aliceId, null, adminAuth);
  check('Admin sees 2 messages', adminMsgs.data.length === 2);

  // 11. After reading, unread should be 0
  console.log('=== 11. Unread count updates ===');
  var chatList2 = await req('GET', AP + '/api/bank/chats', null, adminAuth);
  check('Unread now 0', chatList2.data[0].unreadCount === 0);

  // 12. Admin replies
  console.log('=== 12. Admin replies ===');
  var adminReply = await req('POST', AP + '/api/bank/chats/' + aliceId + '/send', { text: 'Hi Alice, how can I help you?' }, adminAuth);
  check('Admin reply sent', adminReply.status === 200 && adminReply.data.success);

  // 13. Admin sends image
  console.log('=== 13. Admin sends image ===');
  var adminImg = await req('POST', AP + '/api/bank/chats/' + aliceId + '/send', { text: '', imageData: 'data:image/jpeg;base64,fakeadminimg', imageName: 'help.jpg' }, adminAuth);
  check('Admin image sent', adminImg.status === 200);

  // 14. User sees admin messages
  console.log('=== 14. User sees admin replies ===');
  var allMsgs = await req('GET', '/api/bank/chat/messages', null, { Authorization: 'Bearer ' + aliceToken });
  check('User sees 4 total messages', allMsgs.data.length === 4);
  check('Admin reply text correct', allMsgs.data[2].text === 'Hi Alice, how can I help you?');
  check('Admin image present', allMsgs.data[3].imageData !== null);

  // 15. Empty message rejected
  console.log('=== 15. Empty message rejected ===');
  var emptyMsg = await req('POST', '/api/bank/chat/send', { text: '' }, { Authorization: 'Bearer ' + aliceToken });
  check('Empty rejected', emptyMsg.status === 400);

  // Summary
  console.log('\n========================================');
  console.log('PASSED: ' + passed + ' / ' + (passed + failed));
  if (failed === 0) console.log('ALL TESTS PASSED - v4.0 works perfectly');
  else console.log('FAILED: ' + failed + ' tests');
}

test().catch(function(e) { console.error('FATAL:', e); process.exit(1); });
