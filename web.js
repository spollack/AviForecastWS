var express = require('express');

var app = express.createServer(express.logger());

app.get('/region/:id', function(request, response) {
  response.send('Hello ' + request.params.id + '!\n');
});

var port = process.env.PORT || 5000;
app.listen(port, function() {
  console.log("Listening on " + port);
});
