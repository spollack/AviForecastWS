//
// required packages
//
var fs = require('fs');

// trimDigitsInRegionsJSONFile('../public/v1/regions.json', '../public/v1/regions.json', 3);
// trimDigitsInRegionsJSONFile('nwac/nwac_regions.json', 'nwac/nwac_regions.json', 3);
// trimDigitsInRegionsJSONFile('Canada_all/canada_regions_wb_fix_simplified.json', 'Canada_all/canada_regions_wb_fix_simplified.json', 3);
// trimDigitsInRegionsJSONFile('btac/btac_simplified.json', 'btac/btac_simplified.json', 3);
// trimDigitsInRegionsJSONFile('sac/sac_simplified.json', 'sac/sac_simplified.json', 3);
// trimDigitsInRegionsJSONFile('uac/uac_simplified.json', 'uac/uac_simplified.json', 3);
// trimDigitsInRegionsJSONFile('caic/caic_simplified.json', 'caic/caic_simplified.json', 3);
// trimDigitsInRegionsJSONFile('esac/esac_simplified.json', 'esac/esac_simplified.json', 3);
// trimDigitsInRegionsJSONFile('gnfac/gnfac_simplified.json', 'gnfac/gnfac_simplified.json', 3);
// trimDigitsInRegionsJSONFile('snfac/snfac_simplified.json', 'snfac/snfac_simplified.json', 3);
// trimDigitsInRegionsJSONFile('wcmac/wcmac_simplified_ipac_fix.json', 'wcmac/wcmac_simplified_ipac_fix.json', 3);
// trimDigitsInRegionsJSONFile('ipac/ipac_simplified.json', 'ipac/ipac_simplified.json', 3);
// trimDigitsInRegionsJSONFile('cnfaic/cnfaic_simplified.json', 'cnfaic/cnfaic_simplified.json', 3);
// trimDigitsInRegionsJSONFile('aac/aac_simplified.json', 'aac/aac_simplified.json', 3);
// trimDigitsInRegionsJSONFile('jac/jac_simplified.json', 'jac/jac_simplified.json', 3);
// trimDigitsInRegionsJSONFile('haic/haic_simplified.json', 'haic/haic_simplified.json', 3);
trimDigitsInRegionsJSONFile('fac/fac_simplified.json', 'fac/fac_simplified.json', 3);


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
