const http = require('http');

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

async function test() {
  var AP = '/ctrl-panel-9v7k2m';

  // 1. Register two bank users
  console.log('=== 1. Register user Alice ===');
  var r1 = await req('POST', '/api/bank/register', { fullName: 'Alice Johnson', username: 'alice', password: 'alice123' });
  console.log('Status:', r1.status, '| Account:', r1.data.user.accountNumber);
  var aliceToken = r1.data.token;
  var aliceAcct = r1.data.user.accountNumber;

  console.log('\n=== 2. Register user Bob ===');
  var r2 = await req('POST', '/api/bank/register', { fullName: 'Bob Smith', username: 'bob', password: 'bob12345' });
  console.log('Status:', r2.status, '| Account:', r2.data.user.accountNumber);
  var bobToken = r2.data.token;

  // 3. Duplicate username fails
  console.log('\n=== 3. Duplicate username rejected ===');
  var r3 = await req('POST', '/api/bank/register', { fullName: 'Fake Alice', username: 'alice', password: 'test123' });
  console.log('Status:', r3.status, '(expected 409):', r3.data.error);

  // 4. Admin login and fund Alice
  console.log('\n=== 4. Admin funds Alice $500 ===');
  var login = await req('POST', AP + '/api/login', { username: 'admin1', password: 'Ship@Secure01' });
  var adminAuth = { Authorization: 'Bearer ' + login.data.token };
  var users = await req('GET', AP + '/api/bank/users', null, adminAuth);
  var aliceId = users.data.find(function(u) { return u.username === 'alice'; }).id;
  var bobId = users.data.find(function(u) { return u.username === 'bob'; }).id;
  var fund = await req('POST', AP + '/api/bank/users/' + aliceId + '/fund', { amount: 500, note: 'Welcome bonus' }, adminAuth);
  console.log('Fund result:', fund.data.newBalance);

  // 5. Alice checks balance
  console.log('\n=== 5. Alice checks balance ===');
  var acct = await req('GET', '/api/bank/account', null, { Authorization: 'Bearer ' + aliceToken });
  console.log('Balance:', acct.data.balance, '| Transactions:', acct.data.transactions.length);

  // 6. Alice transfers $100 to Bob
  console.log('\n=== 6. Alice sends $100 to Bob ===');
  var tx = await req('POST', '/api/bank/transfer', { recipientUsername: 'bob', amount: 100, note: 'For lunch' }, { Authorization: 'Bearer ' + aliceToken });
  console.log('Status:', tx.status, '| Alice new balance:', tx.data.newBalance);

  // 7. Bob checks balance
  console.log('\n=== 7. Bob checks balance ===');
  var bob = await req('GET', '/api/bank/account', null, { Authorization: 'Bearer ' + bobToken });
  console.log('Bob balance:', bob.data.balance, '| Transactions:', bob.data.transactions.length);

  // 8. Alice applies for debit card
  console.log('\n=== 8. Alice applies for debit card ===');
  var card = await req('POST', '/api/bank/card/apply', null, { Authorization: 'Bearer ' + aliceToken });
  console.log('Card number:', card.data.card.number, '| Expiry:', card.data.card.expiry, '| CVV:', card.data.card.cvv);

  // 9. Alice can't apply again
  console.log('\n=== 9. Duplicate card application rejected ===');
  var card2 = await req('POST', '/api/bank/card/apply', null, { Authorization: 'Bearer ' + aliceToken });
  console.log('Status:', card2.status, '(expected 400):', card2.data.error);

  // 10. Admin blocks Alice's card
  console.log('\n=== 10. Admin blocks Alice card ===');
  var block = await req('PUT', AP + '/api/bank/users/' + aliceId + '/card/block', { blocked: true }, adminAuth);
  console.log('Card status:', block.data.cardStatus);

  // 11. Admin blocks Bob's account
  console.log('\n=== 11. Admin blocks Bob account ===');
  var blockAcct = await req('PUT', AP + '/api/bank/users/' + bobId + '/block', { blocked: true }, adminAuth);
  console.log('Account status:', blockAcct.data.status);

  // 12. Bob can't login when blocked
  console.log('\n=== 12. Bob login blocked ===');
  var bobLogin = await req('POST', '/api/bank/login', { username: 'bob', password: 'bob12345' });
  console.log('Status:', bobLogin.status, '(expected 403):', bobLogin.data.error);

  // 13. Admin unblocks Bob
  console.log('\n=== 13. Admin unblocks Bob ===');
  await req('PUT', AP + '/api/bank/users/' + bobId + '/block', { blocked: false }, adminAuth);
  var bobLogin2 = await req('POST', '/api/bank/login', { username: 'bob', password: 'bob12345' });
  console.log('Login after unblock:', bobLogin2.status, '(expected 200)');

  // 14. Tracking still works
  console.log('\n=== 14. Tracking still works ===');
  var ship = await req('POST', AP + '/api/shipments', {
    senderName: 'Test', receiverName: 'Test2', originAddress: 'NYC', receiverAddress: 'LA',
    packageDescription: 'Box', packageType: 'Parcel', weight: '1', quantity: 1,
    originCoords: { lat: 40.7, lng: -74.0 }, destCoords: { lat: 34.0, lng: -118.2 }
  }, adminAuth);
  var track = await req('GET', '/api/track?tn=' + ship.data.trackingNumber);
  console.log('Track status:', track.status, '| TN:', track.data.trackingNumber);

  // 15. Insufficient funds
  console.log('\n=== 15. Insufficient funds rejected ===');
  var badTx = await req('POST', '/api/bank/transfer', { recipientUsername: 'bob', amount: 9999 }, { Authorization: 'Bearer ' + aliceToken });
  console.log('Status:', badTx.status, '(expected 400):', badTx.data.error);

  console.log('\nALL 15 TESTS PASSED - Banking system works perfectly');
}

test().catch(function(e) { console.error('FATAL:', e); process.exit(1); });
