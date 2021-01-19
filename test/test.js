//
// required packages
//
var should = require('should');
var winston = require('winston');
var fs = require('fs');
var moment = require('moment');
var forecasts = require('../forecasts.js');


// set up the logger
winston.remove(winston.transports.Console);
// verbose, info, warn, error are the log levels we're using
winston.add(winston.transports.Console, {level: 'error', handleExceptions: true});


describe('aviLevelFromName', function(){
    describe('matching strings', function(){
        it('should return the correct avi Level', function(){
            forecasts.aviLevelFromName('low').should.equal(1);
            forecasts.aviLevelFromName('moderate').should.equal(2);
            forecasts.aviLevelFromName('considerable').should.equal(3);
            forecasts.aviLevelFromName('high').should.equal(4);
            forecasts.aviLevelFromName('extreme').should.equal(5);
            forecasts.aviLevelFromName('Low').should.equal(1);
            forecasts.aviLevelFromName('lOW').should.equal(1);
            forecasts.aviLevelFromName(' low').should.equal(1);
            forecasts.aviLevelFromName('low ').should.equal(1);
            forecasts.aviLevelFromName(' low ').should.equal(1);
            forecasts.aviLevelFromName('   lOw ').should.equal(1);
        })
    })
    describe('non-matching strings', function(){
        it('should return 0', function(){
            forecasts.aviLevelFromName('foo').should.equal(0);
            forecasts.aviLevelFromName('lower').should.equal(0);
            forecasts.aviLevelFromName('no-data').should.equal(0);
            forecasts.aviLevelFromName('').should.equal(0);
            forecasts.aviLevelFromName(null).should.equal(0);
        })
    })
})

describe('findHighestAviLevelInString', function(){
    describe('matching strings', function(){
        it('should return the correct avi Level', function(){
            forecasts.findHighestAviLevelInString('low').should.equal(1);
            forecasts.findHighestAviLevelInString('moderate').should.equal(2);
            forecasts.findHighestAviLevelInString('considerable').should.equal(3);
            forecasts.findHighestAviLevelInString('high').should.equal(4);
            forecasts.findHighestAviLevelInString('extreme').should.equal(5);
            forecasts.findHighestAviLevelInString('Low').should.equal(1);
            forecasts.findHighestAviLevelInString('lOW').should.equal(1);
            forecasts.findHighestAviLevelInString(' low').should.equal(1);
            forecasts.findHighestAviLevelInString('low ').should.equal(1);
            forecasts.findHighestAviLevelInString(' low ').should.equal(1);
            forecasts.findHighestAviLevelInString('   lOw ').should.equal(1);
        })
    })
    describe('non-matching strings', function(){
        it('should return 0', function(){
            forecasts.findHighestAviLevelInString('foo').should.equal(0);
            forecasts.findHighestAviLevelInString('lower').should.equal(0);
            forecasts.findHighestAviLevelInString('lowhigh').should.equal(0);
            forecasts.findHighestAviLevelInString('').should.equal(0);
            forecasts.findHighestAviLevelInString(null).should.equal(0);
        })
    })
    describe('multiple matching strings', function(){
        it('should return the highest level', function(){
            forecasts.findHighestAviLevelInString('low high').should.equal(4);
            forecasts.findHighestAviLevelInString(' low high   ').should.equal(4);
            forecasts.findHighestAviLevelInString('high low').should.equal(4);
            forecasts.findHighestAviLevelInString('low low').should.equal(1);
            forecasts.findHighestAviLevelInString('low high low').should.equal(4);
            forecasts.findHighestAviLevelInString('low highways').should.equal(1);
        })
    })
})

describe('getRegionDetailsForRegionId', function(){
    describe('matching strings', function(){
        it('should return the correct region details', function(){
            forecasts.getRegionDetailsForRegionId('nwac_139').should.have.property('provider','nwac');
            forecasts.getRegionDetailsForRegionId('cac_1').should.have.property('provider','cac');
            forecasts.getRegionDetailsForRegionId('pc_1').should.have.property('provider','pc');
            forecasts.getRegionDetailsForRegionId('caic_1b').should.have.property('provider','caic');
        })
    })
    describe('non-matching strings', function(){
        it('should return null', function(){
            should.not.exist(forecasts.getRegionDetailsForRegionId('foo'));
            should.not.exist(forecasts.getRegionDetailsForRegionId('foo_bar'));
            should.not.exist(forecasts.getRegionDetailsForRegionId(''));
            should.not.exist(forecasts.getRegionDetailsForRegionId(null));
            should.not.exist(forecasts.getRegionDetailsForRegionId('caic_0123456'));
        })
    })
})

describe('validateForecast', function(){
    describe('null forecasts', function(){
        it('should return false, unless it is a known exception region', function(){
            forecasts.validateForecast('nwac_139', null).should.be.false;
            forecasts.validateForecast('cacb_north-rockies', null).should.be.true;     // NOTE this region currently never issues danger levels
        })
    })
    describe('valid forecasts', function(){
        it('should return true', function(){
            forecasts.validateForecast('cac_sea-to-sky',
                forecasts.parseForecast_cac(fs.readFileSync('test/data/cac/file002.json','utf8'),
                forecasts.getRegionDetailsForRegionId('cac_sea-to-sky')), false).should.be.true;

            forecasts.validateForecast('caic_8',
                forecasts.parseForecast_simple_caaml(fs.readFileSync('test/data/caic/file002.xml','utf8'),
                forecasts.getRegionDetailsForRegionId('caic_8')), false).should.be.true;
        })
    })
    describe('forecasts with bad dates', function(){
        it('should return false', function(){
            forecasts.validateForecast('nwac_139', [{date:'2012-01-01', aviLevel:1},{date:'2012-01-03', aviLevel:1}], false).should.be.false;
            forecasts.validateForecast('nwac_139', [{date:'2012-01-01', aviLevel:1},{date:'2012-01-01', aviLevel:1}], false).should.be.false;
            forecasts.validateForecast('nwac_139', [{date:'2012-01-01', aviLevel:1},{date:'2011-12-31', aviLevel:1}], false).should.be.false;
            forecasts.validateForecast('nwac_139', [{date:'2012-01-01', aviLevel:1},{date:'2012-01-02', aviLevel:1},{date:'2012-01-04', aviLevel:1}], false).should.be.false;
            forecasts.validateForecast('nwac_139', [{date:'2012-01-01', aviLevel:1},{date:'2012-01-02', aviLevel:1},{date:'2012-01-01', aviLevel:1}], false).should.be.false;
        })
    })
    describe('forecasts with bad aviLevels', function(){
        it('should return false', function(){
            forecasts.validateForecast('nwac_139', [{date:'2012-01-01', aviLevel:1},{date:'2012-01-02', aviLevel:0}], false).should.be.false;
            forecasts.validateForecast('nwac_139', [{date:'2012-01-01', aviLevel:0},{date:'2012-01-02', aviLevel:1}], false).should.be.false;
            forecasts.validateForecast('nwac_139', [{date:'2012-01-01', aviLevel:4},{date:'2012-01-02', aviLevel:1},{date:'2012-01-03', aviLevel:0}], false).should.be.false;
        })
    })
})

describe('validateForecastForCurrentDay', function(){
    describe('current date is not represented', function(){
        it('should return false', function(){
            forecasts.validateForecastForCurrentDay('nwac_139', [{date:'2012-01-01', aviLevel:2},{date:'2012-01-02', aviLevel:3}]).should.be.false;
        })
    })
    describe('current date is not represented', function(){
        it('should return true', function(){
            // NOTE this is run using current local time...
            forecasts.validateForecastForCurrentDay('nwac_139',
                [{date:moment().format('YYYY-MM-DD'), aviLevel:2},{date:moment().add(1, 'days').format('YYYY-MM-DD'), aviLevel:3}]).should.be.true;
        })
    })
})

describe('dateStringFromDateTimeString_caaml', function(){
    describe('valid strings', function(){
        it('should return the correct date', function(){
            forecasts.dateStringFromDateTimeString_caaml('2012-02-02T18:14:00').should.equal('2012-02-02');
            forecasts.dateStringFromDateTimeString_caaml('2012-02-10T00:00:00Z').should.equal('2012-02-10');
            forecasts.dateStringFromDateTimeString_caaml('2012-02-02').should.equal('2012-02-02');
        })
    })
})

describe('parseForecast_cac', function(){
    describe('file000.json', function(){
        it('should fail gracefully on bad input', function(){
            var forecast = forecasts.parseForecast_cac(fs.readFileSync('test/data/cac/file000.json','utf8'),
                forecasts.getRegionDetailsForRegionId('cac_0'));

            should.not.exist(forecast);
        })
    })
    describe('file001.json', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_cac(fs.readFileSync('test/data/cac/file001.json','utf8'),
                forecasts.getRegionDetailsForRegionId('cac_kananaskis'));

            should.exist(forecast);
            forecast.length.should.equal(4);
            forecast[0].date.should.equal('2016-12-11');
            forecast[1].date.should.equal('2016-12-12');
            forecast[2].date.should.equal('2016-12-13');
            forecast[3].date.should.equal('2016-12-14');
            forecast[0].aviLevel.should.equal(2);
            forecast[1].aviLevel.should.equal(2);
            forecast[2].aviLevel.should.equal(2);
            forecast[3].aviLevel.should.equal(2);
        })
    })
    describe('file002.json', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_cac(fs.readFileSync('test/data/cac/file002.json','utf8'),
                forecasts.getRegionDetailsForRegionId('cac_sea-to-sky'));

            should.exist(forecast);
            forecast.length.should.equal(4);
            forecast[0].date.should.equal('2016-12-11');
            forecast[1].date.should.equal('2016-12-12');
            forecast[2].date.should.equal('2016-12-13');
            forecast[3].date.should.equal('2016-12-14');
            forecast[0].aviLevel.should.equal(2);
            forecast[1].aviLevel.should.equal(2);
            forecast[2].aviLevel.should.equal(2);
            forecast[3].aviLevel.should.equal(2);
        })
    })
})

describe('parseForecast_pc', function(){
    describe('file000.xml', function(){
        it('should fail gracefully on bad input', function(){
            var forecast = forecasts.parseForecast_pc(fs.readFileSync('test/data/pc/file000.xml','utf8'),
                forecasts.getRegionDetailsForRegionId('pc_0'));

            should.not.exist(forecast);
        })
    })
    describe('file001.xml', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_pc(fs.readFileSync('test/data/pc/file001.xml','utf8'),
                forecasts.getRegionDetailsForRegionId('pc_1'));

            should.exist(forecast);
            forecast.length.should.equal(4);
            forecast[0].date.should.equal('2012-02-10');
            forecast[1].date.should.equal('2012-02-11');
            forecast[2].date.should.equal('2012-02-12');
            forecast[3].date.should.equal('2012-02-13');
            forecast[0].aviLevel.should.equal(1);
            forecast[1].aviLevel.should.equal(1);
            forecast[2].aviLevel.should.equal(1);
            forecast[3].aviLevel.should.equal(1);
        })
    })
    describe('file002.xml', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_pc(fs.readFileSync('test/data/pc/file002.xml','utf8'),
                forecasts.getRegionDetailsForRegionId('pc_3'));

            should.exist(forecast);
            forecast.length.should.equal(4);
            forecast[0].date.should.equal('2012-02-08');
            forecast[1].date.should.equal('2012-02-09');
            forecast[2].date.should.equal('2012-02-10');
            forecast[3].date.should.equal('2012-02-11');
            forecast[0].aviLevel.should.equal(2);
            forecast[1].aviLevel.should.equal(2);
            forecast[2].aviLevel.should.equal(2);
            forecast[3].aviLevel.should.equal(2);
        })
    })
    describe('file003.xml', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_pc(fs.readFileSync('test/data/pc/file003.xml','utf8'),
                forecasts.getRegionDetailsForRegionId('pc_2'));

            // NOTE this test case if for the case where there is a bogus issued timestamp that is in the future
            // (this forecast was actually issued on 2012-02-16, but says it was issued on 2012-02-17)
            should.exist(forecast);
            forecast.length.should.equal(4);
            forecast[0].date.should.equal('2012-02-16');
            forecast[1].date.should.equal('2012-02-17');
            forecast[2].date.should.equal('2012-02-18');
            forecast[3].date.should.equal('2012-02-19');
            forecast[0].aviLevel.should.equal(1);
            forecast[1].aviLevel.should.equal(1);
            forecast[2].aviLevel.should.equal(1);
            forecast[3].aviLevel.should.equal(1);
        })
    })
    describe('file004.xml', function(){
        it('should return the correct forecast details, meaning level 0 for everything', function(){
            var forecast = forecasts.parseForecast_pc(fs.readFileSync('test/data/pc/file004.xml','utf8'),
                forecasts.getRegionDetailsForRegionId('pc_4'));

            // NOTE this test case if for the case where there is a bogus issued timestamp that is in the future
            // (this forecast was actually issued on 2012-02-16, but says it was issued on 2012-02-17)
            should.exist(forecast);
            forecast.length.should.equal(4);
            forecast[0].date.should.equal('2012-04-17');
            forecast[1].date.should.equal('2012-04-18');
            forecast[2].date.should.equal('2012-04-19');
            forecast[3].date.should.equal('2012-04-20');
            forecast[0].aviLevel.should.equal(0);
            forecast[1].aviLevel.should.equal(0);
            forecast[2].aviLevel.should.equal(0);
            forecast[3].aviLevel.should.equal(0);
        })
    })
})

describe('parseForecast_simple_caaml caic', function(){
    describe('file000.xml', function(){
        it('should fail gracefully on bad input', function(){
            var forecast = forecasts.parseForecast_simple_caaml(fs.readFileSync('test/data/caic/file000.xml','utf8'),
                forecasts.getRegionDetailsForRegionId('caic_0a'));

            should.not.exist(forecast);
        })
    })
    describe('file001.xml', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_simple_caaml(fs.readFileSync('test/data/caic/file001.xml','utf8'),
                forecasts.getRegionDetailsForRegionId('caic_4'));

            should.exist(forecast);
            forecast.length.should.equal(1);
            forecast[0].date.should.equal('2012-02-13');
            forecast[0].aviLevel.should.equal(3);
        })
    })
    describe('file002.xml', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_simple_caaml(fs.readFileSync('test/data/caic/file002.xml','utf8'),
                forecasts.getRegionDetailsForRegionId('caic_8'));

            should.exist(forecast);
            forecast.length.should.equal(1);
            forecast[0].date.should.equal('2012-02-13');
            forecast[0].aviLevel.should.equal(4);
        })
    })
    describe('file003.xml', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_simple_caaml(fs.readFileSync('test/data/caic/file003.xml','utf8'),
                forecasts.getRegionDetailsForRegionId('caic_2'));

            should.exist(forecast);
            forecast.length.should.equal(2);
            forecast[0].date.should.equal('2018-12-14');
            forecast[1].date.should.equal('2018-12-15');
            forecast[0].aviLevel.should.equal(2);
            forecast[1].aviLevel.should.equal(2);
        })
    })
})

describe('parseForecast_simple_caaml btac', function(){
    describe('file001.xml', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_simple_caaml(fs.readFileSync('test/data/btac/file001.xml','utf8'),
                forecasts.getRegionDetailsForRegionId('btac_teton'));

            should.exist(forecast);
            forecast.length.should.equal(1);
            forecast[0].date.should.equal('2012-12-14');
            forecast[0].aviLevel.should.equal(2);
        })
    })
    describe('file002.xml', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_simple_caaml(fs.readFileSync('test/data/btac/file002.xml','utf8'),
                forecasts.getRegionDetailsForRegionId('btac_teton'));

            should.exist(forecast);
            forecast.length.should.equal(1);
            forecast[0].date.should.equal('2018-12-15');
            forecast[0].aviLevel.should.equal(2);
        })
    })
})

describe('parseForecast_avalanche_org_api snfac', function(){
    describe('file001.json', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_avalanche_org_api(fs.readFileSync('test/data/snfac/file001.json','utf8'),
                forecasts.getRegionDetailsForRegionId('snfac_293'));

            should.exist(forecast);
            forecast.length.should.equal(2);
            forecast[0].date.should.equal('2020-01-05');
            forecast[0].aviLevel.should.equal(3);
            forecast[1].date.should.equal('2020-01-06');
            forecast[1].aviLevel.should.equal(3);
        })
    })
})

describe('parseForecast_avalanche_org_api gnfac', function(){
    describe('file001.json', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_avalanche_org_api(fs.readFileSync('test/data/gnfac/file001.json','utf8'),
                forecasts.getRegionDetailsForRegionId('gnfac_111'));

            should.exist(forecast);
            forecast.length.should.equal(2);
            forecast[0].date.should.equal('2020-01-14');
            forecast[0].aviLevel.should.equal(3);
            forecast[1].date.should.equal('2020-01-15');
            forecast[1].aviLevel.should.equal(3);
        })
    })
})

describe('parseForecast_avalanche_org_api coaa', function(){
    describe('file001.json', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_avalanche_org_api(fs.readFileSync('test/data/coaa/file001.json','utf8'),
                forecasts.getRegionDetailsForRegionId('coaa_205'));

                should.exist(forecast);
                forecast.length.should.equal(2);
                forecast[0].date.should.equal('2021-01-15');
                forecast[0].aviLevel.should.equal(1);
                forecast[1].date.should.equal('2021-01-16');
                forecast[1].aviLevel.should.equal(1);
        })
    })
})

describe('parseForecast_avalanche_org_api aaic', function(){
    describe('file001.json', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_avalanche_org_api(fs.readFileSync('test/data/aaic/file001.json','utf8'),
                forecasts.getRegionDetailsForRegionId('aaic_193'));

            should.not.exist(forecast);
        })
    })
})

describe('parseForecast_avalanche_org_api bac', function(){
    describe('file001.json', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_avalanche_org_api(fs.readFileSync('test/data/bac/file001.json','utf8'),
                forecasts.getRegionDetailsForRegionId('bac_261'));

            should.not.exist(forecast);
        })
    })
})

describe('parseForecast_avalanche_org_api tac', function(){
    describe('file001.json', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_avalanche_org_api(fs.readFileSync('test/data/tac/file001.json','utf8'),
                forecasts.getRegionDetailsForRegionId('tac_260'));

            should.exist(forecast);
            //forecast.length.should.equal(1);
            forecast[0].date.should.equal('2020-01-14');
            forecast[0].aviLevel.should.equal(0);
        })
    })
})

describe('parseForecast_avalanche_org_api uac', function(){
    describe('file001.json', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_avalanche_org_api(fs.readFileSync('test/data/uac/file001.json','utf8'),
                forecasts.getRegionDetailsForRegionId('uac_253'));

            should.exist(forecast);
            forecast.length.should.equal(2);
            forecast[0].date.should.equal('2020-01-14');
            forecast[0].aviLevel.should.equal(2);
            forecast[1].date.should.equal('2020-01-15');
            forecast[1].aviLevel.should.equal(2);
        })
    })
})

describe('parseForecast_avalanche_org_api cnfaic', function(){
    describe('file001.json', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_avalanche_org_api(fs.readFileSync('test/data/cnfaic/file001.json','utf8'),
                forecasts.getRegionDetailsForRegionId('cnfaic_122'));

            should.exist(forecast);
            forecast.length.should.equal(2);
            forecast[0].date.should.equal('2020-01-14');
            forecast[0].aviLevel.should.equal(2);
            forecast[1].date.should.equal('2020-01-15');
            forecast[1].aviLevel.should.equal(2);
        })
    })
})

describe('parseForecast_avalanche_org_api mwac', function(){
    describe('file001.json', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_avalanche_org_api(fs.readFileSync('test/data/mwac/file001.json','utf8'),
                forecasts.getRegionDetailsForRegionId('mwac_297'));

            should.exist(forecast);
            forecast.length.should.equal(2);
            forecast[0].date.should.equal('2020-01-14');
            forecast[0].aviLevel.should.equal(1);
            forecast[1].date.should.equal('2020-01-15');
            forecast[1].aviLevel.should.equal(1);
        })
    })
})

describe('parseForecast_avalanche_org_api wac', function(){
    describe('file001.json', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_avalanche_org_api(fs.readFileSync('test/data/wac/file001.json','utf8'),
                forecasts.getRegionDetailsForRegionId('wac_276'));

            should.not.exist(forecast);
        })
    })
})

describe('parseForecast_avalanche_org_api nwac', function(){
    describe('file001.json', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_avalanche_org_api(fs.readFileSync('test/data/nwac/file001.json','utf8'),
                forecasts.getRegionDetailsForRegionId('nwac_140'));

            should.exist(forecast);
            forecast.length.should.equal(2);
            forecast[0].date.should.equal('2020-12-24');
            forecast[0].aviLevel.should.equal(2);
            forecast[1].date.should.equal('2020-12-25');
            forecast[1].aviLevel.should.equal(2);
        })
    })
})

// NOTE parser is temporarily disabled
// describe('parseForecast_viac', function(){
//     describe('file000.html', function(){
//         it('should fail gracefully on bad input', function(){
//             var forecast = forecasts.parseForecast_viac(fs.readFileSync('test/data/viac/file000.html','utf8'),
//                 forecasts.getRegionDetailsForRegionId('viac_1'));
//
//             should.not.exist(forecast);
//         })
//     })
//     describe('file001.html', function(){
//         it('should return the correct forecast details', function(){
//             var forecast = forecasts.parseForecast_viac(fs.readFileSync('test/data/viac/file001.html','utf8'),
//                 forecasts.getRegionDetailsForRegionId('viac_1'));
//
//             should.exist(forecast);
//             forecast.length.should.equal(3);
//             forecast[0].date.should.equal('2020-02-21');
//             forecast[1].date.should.equal('2020-02-22');
//             forecast[2].date.should.equal('2020-02-23');
//             forecast[0].aviLevel.should.equal(2);
//             forecast[1].aviLevel.should.equal(2);
//             forecast[2].aviLevel.should.equal(3);
//         })
//     })
// })

describe('parseForecast_avalanche_org_api sac', function(){
    describe('file001.json', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_avalanche_org_api(fs.readFileSync('test/data/sac/file001.json','utf8'),
                forecasts.getRegionDetailsForRegionId('sac_77'));

            should.exist(forecast);
            forecast.length.should.equal(2);
            forecast[0].date.should.equal('2021-01-19');
            forecast[0].aviLevel.should.equal(1);
            forecast[1].date.should.equal('2021-01-20');
            forecast[1].aviLevel.should.equal(1);
        })
    })
})

describe('parseForecast_avalanche_org_api esac', function(){
    describe('file001.json', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_avalanche_org_api(fs.readFileSync('test/data/esac/file001.json','utf8'),
                forecasts.getRegionDetailsForRegionId('esac_128'));

            should.exist(forecast);
            forecast.length.should.equal(2);
            forecast[0].date.should.equal('2021-01-16');
            forecast[0].aviLevel.should.equal(1);
            forecast[1].date.should.equal('2021-01-17');
            forecast[1].aviLevel.should.equal(1);
        })
    })
})

describe('parseForecast_wcmac', function(){
    describe('file000.xml', function(){
        it('should fail gracefully on bad input', function(){
            var forecast = forecasts.parseForecast_wcmac(fs.readFileSync('test/data/wcmac/file000.xml','utf8'),
                forecasts.getRegionDetailsForRegionId('wcmac_north'));

            should.not.exist(forecast);
        })
    })
    describe('file001.xml', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_wcmac(fs.readFileSync('test/data/wcmac/file001.xml','utf8'),
                forecasts.getRegionDetailsForRegionId('wcmac_north'));

            should.exist(forecast);
            forecast.length.should.equal(1);
            forecast[0].date.should.equal('2013-01-09');
            forecast[0].aviLevel.should.equal(4);
        })
    })
    describe('file002.xml', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_wcmac(fs.readFileSync('test/data/wcmac/file002.xml','utf8'),
                forecasts.getRegionDetailsForRegionId('wcmac_north'));

            should.exist(forecast);
            forecast.length.should.equal(1);
            forecast[0].date.should.equal('2013-01-11');
            forecast[0].aviLevel.should.equal(4);
        })
    })
})

describe('parseForecast_avalanche_org_api ipac', function(){
    describe('file001.json', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_avalanche_org_api(fs.readFileSync('test/data/ipac/file001.json','utf8'),
                forecasts.getRegionDetailsForRegionId('ipac_149'));

            should.exist(forecast);
            forecast.length.should.equal(2);
            forecast[0].date.should.equal('2021-01-19');
            forecast[0].aviLevel.should.equal(2);
            forecast[1].date.should.equal('2021-01-20');
            forecast[1].aviLevel.should.equal(2);
        })
    })
})

describe('parseForecast_avalanche_org_api fac', function(){
    describe('file001.json', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_avalanche_org_api(fs.readFileSync('test/data/fac/file001.json','utf8'),
                forecasts.getRegionDetailsForRegionId('fac_209'));

            should.exist(forecast);
            forecast.length.should.equal(2);
            forecast[0].date.should.equal('2021-01-19');
            forecast[0].aviLevel.should.equal(2);
            forecast[1].date.should.equal('2021-01-20');
            forecast[1].aviLevel.should.equal(2);
        })
    })
})

// NOTE parser is temporarily disabled
// describe('parseForecast_jac', function(){
//     describe('file000.html', function(){
//         it('should fail gracefully on bad input', function(){
//             var forecast = forecasts.parseForecast_jac(fs.readFileSync('test/data/jac/file000.html','utf8'),
//                 forecasts.getRegionDetailsForRegionId('jac_1'));
//
//             should.not.exist(forecast);
//         })
//     })
//     describe('file001.html', function(){
//         it('should return the correct forecast details', function(){
//             var forecast = forecasts.parseForecast_jac(fs.readFileSync('test/data/jac/file001.html','utf8'),
//                 forecasts.getRegionDetailsForRegionId('jac_1'));
//
//             should.exist(forecast);
//             forecast.length.should.equal(1);
//             forecast[0].date.should.equal('2020-02-22');
//             forecast[0].aviLevel.should.equal(3);
//         })
//     })
// })

// NOTE parser is temporarily disabled
// describe('parseForecast_hg', function(){
//     describe('file000.html', function(){
//         it('should fail gracefully on bad input', function(){
//             var forecast = forecasts.parseForecast_hg(fs.readFileSync('test/data/hg/file000.html','utf8'),
//                 forecasts.getRegionDetailsForRegionId('hg_1'));
//
//             should.not.exist(forecast);
//         })
//     })
//     describe('file001.html', function(){
//         it('should return the correct forecast details', function(){
//             var forecast = forecasts.parseForecast_hg(fs.readFileSync('test/data/hg/file001.html','utf8'),
//                 forecasts.getRegionDetailsForRegionId('hg_1'));
//
//             should.exist(forecast);
//             forecast.length.should.equal(3);
//             forecast[0].date.should.equal('2020-02-23');
//             forecast[1].date.should.equal('2020-02-24');
//             forecast[2].date.should.equal('2020-02-25');
//             forecast[0].aviLevel.should.equal(3);
//             forecast[1].aviLevel.should.equal(2);
//             forecast[2].aviLevel.should.equal(2);
//         })
//     })
// })


describe('parseForecast_avalanche_org_api msac', function(){
    describe('file001.json', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_avalanche_org_api(fs.readFileSync('test/data/msac/file001.json','utf8'),
                forecasts.getRegionDetailsForRegionId('msac_123'));

            should.exist(forecast);
            forecast.length.should.equal(2);
            forecast[0].date.should.equal('2021-01-10');
            forecast[0].aviLevel.should.equal(1);
            forecast[1].date.should.equal('2021-01-11');
            forecast[1].aviLevel.should.equal(1);
        })
    })
})

describe('parseForecast_avalanche_org_api pac', function(){
    describe('file001.json', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_avalanche_org_api(fs.readFileSync('test/data/pac/file001.json','utf8'),
                forecasts.getRegionDetailsForRegionId('pac_153'));

            should.exist(forecast);
            forecast.length.should.equal(2);
            forecast[0].date.should.equal('2021-01-19');
            forecast[0].aviLevel.should.equal(2);
            forecast[1].date.should.equal('2021-01-20');
            forecast[1].aviLevel.should.equal(2);
        })
    })
})
