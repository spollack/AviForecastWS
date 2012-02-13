var should = require('should');
var fs = require('fs');
var forecasts = require('../forecasts.js');

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
            forecasts.getRegionDetailsForRegionId('caic_1').should.have.property('provider','caic');
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

describe('parseForecast_nwac', function(){
    describe('file000a.html', function(){
        it('should fail gracefully on bad input', function(){
            var forecast = forecasts.parseForecast_nwac(fs.readFileSync('test/data/nwac/file000a.html','utf8'),
                forecasts.getRegionDetailsForRegionId('nwac_0'));

            should.not.exist(forecast);
        })
    })
    describe('file000b.html', function(){
        it('should fail gracefully on bad input, returning aviLevel 0 for all dates', function(){
            var forecast = forecasts.parseForecast_nwac(fs.readFileSync('test/data/nwac/file000b.html','utf8'),
                forecasts.getRegionDetailsForRegionId('nwac_0'));

            should.exist(forecast);
            forecast.length.should.equal(3);
            forecast[0].date.should.equal('2012-01-16');
            forecast[1].date.should.equal('2012-01-17');
            forecast[2].date.should.equal('2012-01-18');
            forecast[0].aviLevel.should.equal(0);
            forecast[1].aviLevel.should.equal(0);
            forecast[2].aviLevel.should.equal(0);
        })
    })
    describe('file001.html', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_nwac(fs.readFileSync('test/data/nwac/file001.html','utf8'),
                forecasts.getRegionDetailsForRegionId('nwac_1'));

            should.exist(forecast);
            forecast.length.should.equal(3);
            forecast[0].date.should.equal('2012-02-09');
            forecast[1].date.should.equal('2012-02-10');
            forecast[2].date.should.equal('2012-02-11');
            forecast[0].aviLevel.should.equal(2);
            forecast[1].aviLevel.should.equal(2);
            forecast[2].aviLevel.should.equal(2);
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
                forecasts.getRegionDetailsForRegionId('cac_sea-to-sky'));

            should.exist(forecast);
            forecast.length.should.equal(4);
            forecast[0].date.should.equal('2012-02-09');
            forecast[1].date.should.equal('2012-02-10');
            forecast[2].date.should.equal('2012-02-11');
            forecast[3].date.should.equal('2012-02-12');
            forecast[0].aviLevel.should.equal(3);
            forecast[1].aviLevel.should.equal(3);
            forecast[2].aviLevel.should.equal(2);
            forecast[3].aviLevel.should.equal(2);
        })
    })
    describe('file002.xml', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_cac(fs.readFileSync('test/data/cac/file002.xml','utf8'),
                forecasts.getRegionDetailsForRegionId('cac_kananaskis'));

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
            forecast[0].date.should.equal('2012-02-09');
            forecast[1].date.should.equal('2012-02-09');
            forecast[2].date.should.equal('2012-02-10');
            forecast[3].date.should.equal('2012-02-11');
            forecast[0].aviLevel.should.equal(2);
            forecast[1].aviLevel.should.equal(2);
            forecast[2].aviLevel.should.equal(2);
            forecast[3].aviLevel.should.equal(2);
        })
    })
})

describe('parseForecast_caic', function(){
    describe('file000.xml', function(){
        it('should fail gracefully on bad input', function(){
            var forecast = forecasts.parseForecast_caic(fs.readFileSync('test/data/caic/file000.xml','utf8'),
                forecasts.getRegionDetailsForRegionId('caic_0'));

            should.not.exist(forecast);
        })
    })
    describe('file001.xml', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_caic(fs.readFileSync('test/data/caic/file001.xml','utf8'),
                forecasts.getRegionDetailsForRegionId('caic_4'));

            should.exist(forecast);
            forecast.length.should.equal(2);
            forecast[0].date.should.equal('2012-02-13');
            forecast[1].date.should.equal('2012-02-14');
            forecast[0].aviLevel.should.equal(3);
            forecast[1].aviLevel.should.equal(3);
        })
    })
    describe('file002.xml', function(){
        it('should return the correct forecast details', function(){
            var forecast = forecasts.parseForecast_caic(fs.readFileSync('test/data/caic/file002.xml','utf8'),
                forecasts.getRegionDetailsForRegionId('caic_8'));

            should.exist(forecast);
            forecast.length.should.equal(2);
            forecast[0].date.should.equal('2012-02-13');
            forecast[1].date.should.equal('2012-02-14');
            forecast[0].aviLevel.should.equal(4);
            forecast[1].aviLevel.should.equal(4);
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






























