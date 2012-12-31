//
// Copyright (c) 2012 Sebnarware. All rights reserved.
//

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
            forecasts.getRegionDetailsForRegionId('nwac_1').should.have.property('provider','nwac');
            forecasts.getRegionDetailsForRegionId('cac_1').should.have.property('provider','cac');
            forecasts.getRegionDetailsForRegionId('pc_1').should.have.property('provider','pc');
            forecasts.getRegionDetailsForRegionId('caic_010').should.have.property('provider','caic');
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
            forecasts.validateForecast('nwac_1', null).should.be.false;
            forecasts.validateForecast('cac_bighorn', null).should.be.true;     // NOTE this region currently never issues danger levels
        })
    })
    describe('valid forecasts', function(){
        it('should return true', function(){
            forecasts.validateForecast('nwac_1',
                forecasts.parseForecast_nwac(fs.readFileSync('test/data/nwac/file001.json','utf8'),
                forecasts.getRegionDetailsForRegionId('nwac_1')), false).should.be.true;

            forecasts.validateForecast('cac_sea-to-sky',
                forecasts.parseForecast_cac(fs.readFileSync('test/data/cac/file001.xml','utf8'),
                forecasts.getRegionDetailsForRegionId('cac_sea-to-sky')), false).should.be.true;

            forecasts.validateForecast('caic_080',
                forecasts.parseForecast_simple_caaml(fs.readFileSync('test/data/caic/file002.xml','utf8'),
                forecasts.getRegionDetailsForRegionId('caic_080')), false).should.be.true;
        })
    })
    describe('forecasts with bad dates', function(){
        it('should return false', function(){
            forecasts.validateForecast('nwac_1', [{date:'2012-01-01', aviLevel:1},{date:'2012-01-03', aviLevel:1}], false).should.be.false;
            forecasts.validateForecast('nwac_1', [{date:'2012-01-01', aviLevel:1},{date:'2012-01-01', aviLevel:1}], false).should.be.false;
            forecasts.validateForecast('nwac_1', [{date:'2012-01-01', aviLevel:1},{date:'2011-12-31', aviLevel:1}], false).should.be.false;
            forecasts.validateForecast('nwac_1', [{date:'2012-01-01', aviLevel:1},{date:'2012-01-02', aviLevel:1},{date:'2012-01-04', aviLevel:1}], false).should.be.false;
            forecasts.validateForecast('nwac_1', [{date:'2012-01-01', aviLevel:1},{date:'2012-01-02', aviLevel:1},{date:'2012-01-01', aviLevel:1}], false).should.be.false;
        })
    })
    describe('forecasts with bad aviLevels', function(){
        it('should return false', function(){
            forecasts.validateForecast('nwac_1', [{date:'2012-01-01', aviLevel:1},{date:'2012-01-02', aviLevel:0}], false).should.be.false;
            forecasts.validateForecast('nwac_1', [{date:'2012-01-01', aviLevel:0},{date:'2012-01-02', aviLevel:1}], false).should.be.false;
            forecasts.validateForecast('nwac_1', [{date:'2012-01-01', aviLevel:4},{date:'2012-01-02', aviLevel:1},{date:'2012-01-03', aviLevel:0}], false).should.be.false;
        })
    })
})

describe('validateForecastForCurrentDay', function(){
    describe('current date is not represented', function(){
        it('should return false', function(){
            forecasts.validateForecastForCurrentDay('nwac_1', [{date:'2012-01-01', aviLevel:2},{date:'2012-01-02', aviLevel:3}]).should.be.false;
        })
    })
    describe('current date is not represented', function(){
        it('should return true', function(){
            // NOTE this is run using current local time...
            forecasts.validateForecastForCurrentDay('nwac_1',
                [{date:moment().format('YYYY-MM-DD'), aviLevel:2},{date:moment().add('days', 1).format('YYYY-MM-DD'), aviLevel:3}]).should.be.true;
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

describe('parseForecast_nwac', function(){
    describe('file000.json', function(){
        it('should fail gracefully on bad input', function(){
            var forecast = forecasts.parseForecast_nwac(fs.readFileSync('test/data/nwac/file000.json','utf8'),
                forecasts.getRegionDetailsForRegionId('nwac_0'));

            should.not.exist(forecast);
        })
    })
    describe('file001.json', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_nwac(fs.readFileSync('test/data/nwac/file001.json','utf8'),
                forecasts.getRegionDetailsForRegionId('nwac_1'));

            should.exist(forecast);
            forecast.length.should.equal(3);
            forecast[0].date.should.equal('2012-11-02');
            forecast[1].date.should.equal('2012-11-03');
            forecast[2].date.should.equal('2012-11-04');
            forecast[0].aviLevel.should.equal(1);
            forecast[1].aviLevel.should.equal(1);
            forecast[2].aviLevel.should.equal(1);
        })
    })
    describe('file002.json', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_nwac(fs.readFileSync('test/data/nwac/file002.json','utf8'),
                forecasts.getRegionDetailsForRegionId('nwac_12'));

            should.exist(forecast);
            forecast.length.should.equal(3);
            forecast[0].date.should.equal('2012-10-25');
            forecast[1].date.should.equal('2012-10-26');
            forecast[2].date.should.equal('2012-10-27');
            forecast[0].aviLevel.should.equal(2);
            forecast[1].aviLevel.should.equal(2);
            forecast[2].aviLevel.should.equal(2);
        })
    })
    describe('file003.json', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_nwac(fs.readFileSync('test/data/nwac/file003.json','utf8'),
                forecasts.getRegionDetailsForRegionId('nwac_5'));

            should.exist(forecast);
            forecast.length.should.equal(3);
            forecast[0].date.should.equal('2012-11-20');
            forecast[1].date.should.equal('2012-11-21');
            forecast[2].date.should.equal('2012-11-22');
            forecast[0].aviLevel.should.equal(3);
            forecast[1].aviLevel.should.equal(3);
            forecast[2].aviLevel.should.equal(2);
        })
    })
    describe('file005.json', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_nwac(fs.readFileSync('test/data/nwac/file005.json','utf8'),
                forecasts.getRegionDetailsForRegionId('nwac_1'));

            should.exist(forecast);
            forecast.length.should.equal(3);
            forecast[0].date.should.equal('2012-12-18');
            forecast[1].date.should.equal('2012-12-19');
            forecast[2].date.should.equal('2012-12-20');
            forecast[0].aviLevel.should.equal(4);
            forecast[1].aviLevel.should.equal(4);
            forecast[2].aviLevel.should.equal(4);
        })
    })
})

describe('parseForecast_cac', function(){
    describe('file000.xml', function(){
        it('should fail gracefully on bad input', function(){
            var forecast = forecasts.parseForecast_cac(fs.readFileSync('test/data/cac/file000.xml','utf8'),
                forecasts.getRegionDetailsForRegionId('cac_0'));

            should.not.exist(forecast);
        })
    })
    describe('file001.xml', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_cac(fs.readFileSync('test/data/cac/file001.xml','utf8'),
                forecasts.getRegionDetailsForRegionId('cac_kananaskis'));

            should.exist(forecast);
            forecast.length.should.equal(5);
            forecast[0].date.should.equal('2012-12-04');
            forecast[1].date.should.equal('2012-12-05');
            forecast[2].date.should.equal('2012-12-06');
            forecast[3].date.should.equal('2012-12-07');
            forecast[4].date.should.equal('2012-12-08');
            forecast[0].aviLevel.should.equal(3);
            forecast[1].aviLevel.should.equal(3);
            forecast[2].aviLevel.should.equal(4);
            forecast[3].aviLevel.should.equal(3);
            forecast[4].aviLevel.should.equal(2);
        })
    })
    describe('file002.xml', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_cac(fs.readFileSync('test/data/cac/file002.xml','utf8'),
                forecasts.getRegionDetailsForRegionId('cac_sea-to-sky'));

            should.exist(forecast);
            forecast.length.should.equal(5);
            forecast[0].date.should.equal('2012-12-04');
            forecast[1].date.should.equal('2012-12-05');
            forecast[2].date.should.equal('2012-12-06');
            forecast[3].date.should.equal('2012-12-07');
            forecast[4].date.should.equal('2012-12-08');
            forecast[0].aviLevel.should.equal(4);
            forecast[1].aviLevel.should.equal(4);
            forecast[2].aviLevel.should.equal(4);
            forecast[3].aviLevel.should.equal(3);
            forecast[4].aviLevel.should.equal(3);
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
                forecasts.getRegionDetailsForRegionId('caic_000'));

            should.not.exist(forecast);
        })
    })
    describe('file001.xml', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_simple_caaml(fs.readFileSync('test/data/caic/file001.xml','utf8'),
                forecasts.getRegionDetailsForRegionId('caic_040'));

            should.exist(forecast);
            forecast.length.should.equal(1);
            forecast[0].date.should.equal('2012-02-13');
            forecast[0].aviLevel.should.equal(3);
        })
    })
    describe('file002.xml', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_simple_caaml(fs.readFileSync('test/data/caic/file002.xml','utf8'),
                forecasts.getRegionDetailsForRegionId('caic_080'));

            should.exist(forecast);
            forecast.length.should.equal(1);
            forecast[0].date.should.equal('2012-02-13');
            forecast[0].aviLevel.should.equal(4);
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
})

describe('parseForecast_simple_caaml gnfac', function(){
    describe('file001.xml', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_simple_caaml(fs.readFileSync('test/data/gnfac/file001.xml','utf8'),
                forecasts.getRegionDetailsForRegionId('gnfac_Bridgers'));

            should.exist(forecast);
            forecast.length.should.equal(1);
            forecast[0].date.should.equal('2012-12-30');
            forecast[0].aviLevel.should.equal(2);
        })
    })
    describe('file002.xml', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_simple_caaml(fs.readFileSync('test/data/gnfac/file002.xml','utf8'),
                forecasts.getRegionDetailsForRegionId('gnfac_Lionhead_Area'));

            should.exist(forecast);
            forecast.length.should.equal(1);
            forecast[0].date.should.equal('2012-12-30');
            forecast[0].aviLevel.should.equal(2);
        })
    })
})

describe('parseForecast_uac', function(){
    describe('file000.html', function(){
        it('should fail gracefully on bad input', function(){
            var forecast = forecasts.parseForecast_uac(fs.readFileSync('test/data/uac/file000.html','utf8'),
                forecasts.getRegionDetailsForRegionId('uac_slc'));

            should.not.exist(forecast);
        })
    })
    describe('file001.html', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_uac(fs.readFileSync('test/data/uac/file001.html','utf8'),
                forecasts.getRegionDetailsForRegionId('uac_slc'));

            should.exist(forecast);
            forecast.length.should.equal(1);
            forecast[0].date.should.equal('2012-11-09');
            forecast[0].aviLevel.should.equal(2);
        })
    })
    describe('file002.html', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_uac(fs.readFileSync('test/data/uac/file002.html','utf8'),
                forecasts.getRegionDetailsForRegionId('uac_logan'));

            should.exist(forecast);
            forecast.length.should.equal(1);
            forecast[0].date.should.equal('2012-11-09');
            forecast[0].aviLevel.should.equal(2);
        })
    })
    describe('file003.html', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_uac(fs.readFileSync('test/data/uac/file003.html','utf8'),
                forecasts.getRegionDetailsForRegionId('uac_uintas'));

            should.exist(forecast);
            forecast.length.should.equal(1);
            forecast[0].date.should.equal('2012-11-14');
            forecast[0].aviLevel.should.equal(2);
        })
    })
})

describe('parseForecastIssuedDate_viac', function(){
    it('should return the correct date', function(){
        var forecastIssuedDate;

        forecastIssuedDate = forecasts.parseForecastIssuedDate_viac('<div class="date" title="1330111140000"><span class="date_prefix">Date Issued </span>February 24, 2012 at 11:19AM</div>',
            forecasts.getRegionDetailsForRegionId('viac_'));
        moment(forecastIssuedDate).format('YYYY-MM-DD').should.equal('2012-02-24');

        forecastIssuedDate = forecasts.parseForecastIssuedDate_viac('<div class="date" title="1330111140000"><span class="date_prefix">Date Issued </span>February 24th, 2012 at 11:19AM</div>',
            forecasts.getRegionDetailsForRegionId('viac_'));
        moment(forecastIssuedDate).format('YYYY-MM-DD').should.equal('2012-02-24');
    })
})

describe('parseForecast_viac', function(){
    describe('file000.html', function(){
        it('should fail gracefully on bad input', function(){
            var forecast = forecasts.parseForecast_viac(fs.readFileSync('test/data/viac/file000.html','utf8'),
                forecasts.getRegionDetailsForRegionId('viac_'));

            should.not.exist(forecast);
        })
    })
    describe('file001.html', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_viac(fs.readFileSync('test/data/viac/file001.html','utf8'),
                forecasts.getRegionDetailsForRegionId('viac_'));

            should.exist(forecast);
            forecast.length.should.equal(3);
            forecast[0].date.should.equal('2012-11-28');
            forecast[1].date.should.equal('2012-11-29');
            forecast[2].date.should.equal('2012-11-30');
            forecast[0].aviLevel.should.equal(2);
            forecast[1].aviLevel.should.equal(4);
            forecast[2].aviLevel.should.equal(4);
        })
    })
})

describe('parseForecast_sac', function(){
    describe('file000.xml', function(){
        it('should fail gracefully on bad input', function(){
            var forecast = forecasts.parseForecast_sac(fs.readFileSync('test/data/sac/file000.xml','utf8'),
                forecasts.getRegionDetailsForRegionId('sac_1'));

            should.not.exist(forecast);
        })
    })
    describe('file001.xml', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_sac(fs.readFileSync('test/data/sac/file001.xml','utf8'),
                forecasts.getRegionDetailsForRegionId('sac_1'));

            should.exist(forecast);
            forecast.length.should.equal(1);
            forecast[0].date.should.equal('2012-11-18');
            forecast[0].aviLevel.should.equal(2);
        })
    })
})






























