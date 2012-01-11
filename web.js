//
// web server
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

// origRequest/origResponse are the mobile-client-originated HTTP request; not to be confused with
// the server to server request that we initiate here
function onRequest(origRequest, origResponse) {
	var URL = 'http://www.nwac.us/forecast/avalanche/current/zone/6/';
	request(URL, function (error, response, body) {
		if (!error && response.statusCode === 200) {
			console.log("Got a successful response; URL: " + URL);
			console.log(response.body);
			origResponse.send('Hello ' + origRequest.params.id + '!\n');
		} else {
			console.log("Got an error; URL: " + URL + "; status code: " + response.statusCode + "; error: " + error);
			origResponse.send("Error\n"); 
		}
	});
}
