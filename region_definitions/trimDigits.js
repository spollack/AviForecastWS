//
// required packages
//

var fs = require('fs');

trimDigitsInRegionsJSONFile('uac/uac.json','uac/uac.json',4);

function trimDigitsInRegionsJSONFile(inputFilePath, outputFilePath, digits) {
    var input = fs.readFileSync(inputFilePath, 'utf8');
    var output = trimDigits(input, digits);
    fs.writeFileSync(outputFilePath, output, 'utf8');
}

function trimDigits(input, digits) {
    var regions = JSON.parse(input);

    for (var i = 0; i < regions.length; i++) {
        for (var j = 0; j < regions[i].points.length; j++) {
            regions[i].points[j].lat = parseFloat(regions[i].points[j].lat).toFixed(digits);
            regions[i].points[j].lon = parseFloat(regions[i].points[j].lon).toFixed(digits);
        }
    }

    return (JSON.stringify(regions, null, 4));
}
