//
// launch the web server
//

var express = require('express');

var app = express.createServer(express.logger());

app.get('/region/:id', onRequest);

// use the value from the PORT env variable if available
var port = process.env.PORT || 5000;
app.listen(port, function() {
	console.log("Listening on " + port);
});

//
// request handling
//

var http = require('http');

function onRequest(request, response) {
	var options = {
	  host: 'www.google.com',
	  port: 80,
	  path: '/index.html'
	};
	
	http.get(options, function(clientResponse) {
		console.log("Got response: " + clientResponse.statusCode);
		response.send('Hello ' + request.params.id + '!\n');
	}).on('error', function(e) {
		console.log("Got error: " + e.message);
	});
}
