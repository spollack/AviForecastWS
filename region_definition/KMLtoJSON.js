//
// required packages
//
var fs = require('fs');


// KMLFileToJSONFile('nwac/nwac_regions.kml','nwac/nwac_regions.json','nwac','http://www.nwac.us/avalanche-forecast/current/');
// KMLFileToJSONFile('Canada_all/canada_regions_simplified.kml','Canada_all/canada_regions_simplified.json','cac','http://www.avalanche.ca/forecasts/');
// KMLFileToJSONFile('caic/caic_simplified_cbac_fix.kml','caic/caic_simplified_cbac_fix.json','caic','http://aviforecast.herokuapp.com/v1/proxy/caic/');
// KMLFileToJSONFile('uac/uac_simplified.kml','uac/uac_simplified.json','uac','http://utahavalanchecenter.org/advisory/');
// KMLFileToJSONFile('sac/SACForecastArea_simplified.kml','sac/sac_simplified.json','sac','http://www.sierraavalanchecenter.org/advisory');
// KMLFileToJSONFile('btac/JHAFC_Zones_simplified.kml','btac/btac_simplified.json','btac','http://jhavalanche.org/viewOther?area=');
// KMLFileToJSONFile('esac/ESACRegions_simplified.kml','esac/esac_simplified.json','esac','http://esavalanche.org/advisory');
// KMLFileToJSONFile('gnfac/GNFAC_simplified.kml','gnfac/gnfac_simplified.json','gnfac','http://www.mtavalanche.com/current');
// KMLFileToJSONFile('snfac/snfac_simplified.kml','snfac/snfac_simplified.json','snfac','http://www.sawtoothavalanche.com/adv_current.php');
// KMLFileToJSONFile('wcmac/wcmac_simplified.kml','wcmac/wcmac_simplified.json','wcmac','http://www.missoulaavalanche.org/current-advisory/');
// KMLFileToJSONFile('ipac/ipac_simplified.kml','ipac/ipac_simplified.json','ipac','http://www.idahopanhandleavalanche.org/');
// KMLFileToJSONFile('cnfaic/cnfaic_simplified.kml','cnfaic/cnfaic_simplified.json','cnfaic','http://www.cnfaic.org/advisories/');
// KMLFileToJSONFile('aac/aac_simplified.kml','aac/aac_simplified.json','aac','http://www.anchorageavalanchecenter.org/');
// KMLFileToJSONFile('jac/Forecast Area.kml','jac/jac_simplified.json','jac','http://juneau.org/avalanche/');
// KMLFileToJSONFile('haic/haic_simplified.kml','haic/haic_simplified.json','haic','http://alaskasnow.org/haines/conditions.html');
// KMLFileToJSONFile('fac/fac_simplified.kml','fac/fac_simplified.json','fac','http://www.flatheadavalanche.org/category/advisories/');
// KMLFileToJSONFile('vac/vac_simplified.kml','vac/vac_simplified.json','vac','http://www.valdezavalanchecenter.org/category/bulletin/');
// KMLFileToJSONFile('mwac/mwac_simplified.kml','mwac/mwac_simplified.json','mwac','http://www.mountwashingtonavalanchecenter.org/category/avalanche-advisory-for-tuckerman-and-huntington-ravines/');
// KMLFileToJSONFile('kpac/kpac_simplified.kml','kpac/kpac_simplified.json','kpac','http://www.kachinapeaks.org/snow-pack-summaries/');
// KMLFileToJSONFile('cac2/cac2_simplified.kml','cac2/cac2_simplified.json','cac2','http://www.cityofcordova.net/residents/a-safe-cordova/avalanche-conditions');
// KMLFileToJSONFile('hpac/hpac_simplified.kml','hpac/hpac_simplified.json','hpac','http://hatcherpassavalanchecenter.org/');
// KMLFileToJSONFile('msac/msac_simplified.kml','msac/msac_simplified.json','msac','http://www.shastaavalanche.org/advisories/avalanche-advisory');
// KMLFileToJSONFile('pac/pac_simplified.kml','pac/pac_simplified.json','pac','http://payetteavalanche.org/advisory/');
KMLFileToJSONFile('cbac/cbac_simplified.kml','cbac/cbac_simplified.json','cbac','http://cbavalanchecenter.org/');


function KMLFileToJSONFile(KMLFileName, JSONFileName, regionPrefix, URLPrefix) {
    var JSONString = KMLStringToJSONString(fs.readFileSync(KMLFileName, 'utf8'), regionPrefix, URLPrefix);
    if (JSONString) {
        fs.writeFileSync(JSONFileName, JSONString, 'utf8');
    }
}

function KMLStringToJSONString(KML, regionPrefix, URLPrefix) {

    var JSONString = null;

    // grab all the placemarks from the KML
    var placemarkBlocks = KML.match(/<Placemark[^>]*>[\S\s]*?<\/Placemark>/g);
    if (placemarkBlocks) {

        var data = [placemarkBlocks.length];

        for (var i = 0; i < placemarkBlocks.length; i++) {
            //console.log('placemarkBlocks[' + i + ']: ' + placemarkBlocks[i]);

            // for each placemark, grab the data we need

            var nameMatch = placemarkBlocks[i].match(/<name>([\S\s]*?)<\/name>/);
            var name = (nameMatch && nameMatch.length > 1) ? nameMatch[1] : 'TBD';
            //console.log('name: ' + name);

            var oneBasedIndex = i + 1;
            data[i] = {'regionId': regionPrefix + '_' + oneBasedIndex, 'displayName': name, 'URL' : URLPrefix, 'points':[]};

            var coordinatesMatch = placemarkBlocks[i].match(/<coordinates>\s*([\S\s]*?)\s*<\/coordinates>/);
            var coordinatesList = (coordinatesMatch && coordinatesMatch.length > 1) ? coordinatesMatch[1] : '';
            //console.log('coordinatesList: ' + coordinatesList);

            var coordinates = coordinatesList.match(/\s*(\S+)\s*/g);
            if (coordinates) {
                for (var j = 0; j < coordinates.length; j++) {
                    //console.log('coordinates[' + j + ']: ' + coordinates[j]);

                    var components = coordinates[j].match(/[-+]?\d+(?:\.\d*)?/g);
                    if (components && components.length >= 2) {
                        // NOTE latitude comes after longitude in KML ... weird
                        var lat = components[1];
                        var lon = components[0];
                        //console.log('lat: ' + lat + '; lon: ' + lon);

                        data[i].points[j] = {'lat': lat, 'lon': lon};
                    }
                }
            }
        }

        JSONString = JSON.stringify(data, null, 4);
        //console.log(JSONString);
    }

    return JSONString;
}
