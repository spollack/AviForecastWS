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

var request = require('request');

function onRequest(origRequest, origResponse) {
	request('http://www.google.com', function (error, response, body) {
		if (!error && response.statusCode === 200) {
			console.log("Got a successful response");
			origResponse.send('Hello ' + origRequest.params.id + '!\n');
		} else {
			console.log("Got an error");
		}
	});
}
