var spawn = require('child_process').spawn;
var http = require('http');
var fs = require('fs');
var crypto = require('crypto');

function wsHandshake(request, head) {
	var md5 = crypto.createHash('md5');
	var k1 = request.headers['sec-websocket-key1'];
	var k2 = request.headers['sec-websocket-key2'];

	[k1, k2].forEach(function(k){
		var n = parseInt(k.replace(/[^\d]/g, ''));
		var spaces = k.replace(/[^ ]/g, '').length;

		if (spaces === 0 || n % spaces !== 0){
			return null;
		}
		n /= spaces;
		md5.update(String.fromCharCode(
			n >> 24 & 0xFF,
			n >> 16 & 0xFF,
			n >> 8  & 0xFF,
			n       & 0xFF));
	});
	md5.update(head.toString('binary'));
	return md5.digest('binary');	
};

var server = http.createServer();

server.on('request', function(request, response) {
	fs.readFile('./pty.html', function(err, buffer) {
		response.writeHead(200);
		response.end(buffer);
	});
});
server.on('upgrade', function(request, connection, head) {
	connection.setTimeout(0);
	connection.setNoDelay(true);

	var handshake = [
		'HTTP/1.1 101 Web Socket Protocol Handshake', 
		'Upgrade: WebSocket', 
		'Connection: Upgrade',
		'Sec-WebSocket-Origin: ' + request.headers.origin || 'null',
		'Sec-WebSocket-Location: ws://' + request.headers.host + request.url
	];
	var token = wsHandshake(request, head);

	if(token === null) {
		connection.destroy();
		return;
	}
	
	connection.write(handshake.join('\r\n') + '\r\n\r\n' + token, 'binary');
	
	var pty = spawn('python', ['-c', 'import pty;pty.spawn(["bash"])']);

	pty.stdout.on('data', function(data) {
		connection.write('\u0000', 'binary');
		connection.write(data);
		connection.write('\uffff', 'binary');
	});
	pty.on('exit', function() {
		console.log(4) //not ok
	});
	connection.on('data', function(data) {
		var b = [];

		for(var i = 0; i < data.length; i++) {
			if(data[i] !== 0 && data[i] !== 255) {
				b.push(data[i]);
			}
		}
		pty.stdin.write(new Buffer(b));
	});
	connection.on('close', function() {
		pty.kill();
	});
});

server.listen(parseInt(process.argv[2] || '8080', 10));