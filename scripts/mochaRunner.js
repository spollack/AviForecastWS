//
// NOTE adapted from: http://ronderksen.nl/2012/05/03/debugging-mocha-tests-in-webstorm/
//


var Mocha = require('mocha'),
    path = require('path'),
    fs = require('fs');

var mocha = new Mocha({
    reporter: 'dot',
    ui: 'bdd',
    timeout: 999999,
    ignoreLeaks: true
});

var testDir = './test/';

fs.readdir(testDir, function (err, files) {
    if (err) {
        console.log(err);
        return;
    }
    files.forEach(function (file) {
        if (path.extname(file) === '.js' || path.extname(file) === '._js') {
            console.log('adding test file: %s', file);
            mocha.addFile(testDir + file);
        }
    });

    var runner = mocha.run(function () {
        console.log('finished');
        process.exit();
    });


    runner.on('pass', function (test) {
        console.log('... %s passed', getTitle(test));
        console.log('');
    });

    runner.on('fail', function (test) {
        console.log('... %s failed', getTitle(test));
        console.log('');
    });

    function getTitle(test) {
        var title = '';
        var currentNode = test;
        while (currentNode) {
            title = currentNode.title + ': ' + title;
            currentNode = currentNode.parent;
        }
        return title;
    }
});
