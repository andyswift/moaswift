var express = require('express');
var app = express();
var bodyParser = require('body-parser');
var https = require('https');
app.use(bodyParser.json()); // support json encoded bodies
app.use(bodyParser.urlencoded({ extended: true })); // support encoded bodies
app.use( function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept');
  next();
});

app.get('/', function (req, res) {
  res.send('Hello');
});

// create application/json parser
var jsonParser = bodyParser.json();

// POST /login gets urlencoded bodies
app.post('/email', jsonParser, function (req, res) {
  var data = JSON.stringify(req.body);
	var options = {
      host: 'maker.ifttt.com',
      port: 443,
      path: '/trigger/send_email/with/key/chSzc8bv45-zIYBdbVG2Jp',
      method: 'POST',
      headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
      }
  };

  var post = https.request(options, function(result) {});
  post.on('error', function(e) {
    console.log('problem with request: ' + e.message);
  });
  post.write(data);
	res.send('request successful!');
  post.end();
});

var server = app.listen(3000, function () {
  var host = server.address().address;
  var port = server.address().port;
  console.log('Example app listening at http://%s:%s', host, port);
});
