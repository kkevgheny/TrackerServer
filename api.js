var express         = require('express');
var Promise         = require('promise');
var fetch           = require('node-fetch');
var CRON            = require('cron');
var api             = express.Router();
var User            = require('./db').User;
var DataSchema      = require('./db').DataSchema;
var Limits          = require('./db').Limits;

var excelbuilder = require('msexcel-builder');
var fs = require('fs');
var path = require('path');

var   clientID = '2289DH';
var   clientSecret = '5fb5478a042b719140bb2e460331bb17'

var REFRESH_TOKEN_JON = new CRON.CronJob({
    cronTime: '0 * * * *',
    onTick: function(){
        User.find({}, function(err, users){
            if(err) console.log(err);
            users.forEach(user => {
                refreshToken(true, user.fitbitID, user.refreshToken).then(function(){});
            });
        });
    },
    start: false
});
var SYNC_JOB = new CRON.CronJob({
    cronTime: '30 * * * *',
    onTick: function(){
        User.find({}, function(err, users){
            if(err) console.log(err);
            users.forEach(user => {
                GET_USER_DATA(user.fitbitID, true);
            });
        });
    },
    start: false
});


function GetUserCalories(userID, accessToken, period){
    if(period === undefined)    period = '1d';
    return new Promise(function(resolve, reject){
        fetch('https://api.fitbit.com/1/user/'+userID+'/activities/calories/date/today/'+ period + '.json', {method: 'GET', headers: { Authorization: 'Bearer ' + accessToken }
        }).then(function(response){
            return response.json();
        }).then(function(calories){
            return resolve(calories['activities-calories']);
        });
    });
}
function GetUserSteps(userID, accessToken, period){
    if(period === undefined)    period = '1d';
    return new Promise(function(resolve, reject){
        fetch('https://api.fitbit.com/1/user/'+userID+'/activities/steps/date/today/'+ period + '.json', {method: 'GET', headers: { Authorization: 'Bearer ' + accessToken }
        }).then(function(response){
            return response.json();
        }).then(function(steps){
            return resolve(steps['activities-steps']);
        });
    });
}
function GetUserDistance(userID, accessToken,  period){
    if(period === undefined)    period = '1d';
    return new Promise(function(resolve, reject){
        fetch('https://api.fitbit.com/1/user/'+userID+'/activities/distance/date/today/' + period + '.json', {method: 'GET', headers: { Authorization: 'Bearer ' + accessToken }
        }).then(function(response){
            return response.json();
        }).then(function(distance){
            return resolve(distance['activities-distance']);
        });
    });
}

function GetUserHeartRate(userID, accessToken, period){
    if(period === undefined)    period = '1d';
    return new Promise(function(resolve, reject){
        fetch('https://api.fitbit.com/1/user/'+userID+'/activities/heart/date/today/' + period + '.json', {method: 'GET', headers: { Authorization: 'Bearer ' + accessToken }
        }).then(function(response){
            return response.json();
        }).then(function(heartrate){
            resolve(heartrate['activities-heart']);
        });
    });
}
function refreshToken(update, userID, refreshToken){
    return new Promise(function(resolve, reject){
        if(update){
            fetch('https://api.fitbit.com/oauth2/token', {
                method: 'POST', headers: {
                    Authorization: 'Basic ' + new Buffer(clientID + ':' + clientSecret).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: 'grant_type=refresh_token&refresh_token=' + refreshToken
            }).then(function(response){
                return response.json();
            }).then(function(result){
                User.update({fitbitID: userID}, {
                    cronErr         : result,
                    updatedAt       : Date.now(),
                    accessToken     : result.access_token,
                    refreshToken    : result.refresh_token
                }, function(err, affectedCount, rawResponse){
                    resolve();
                });
            });
        }
    });
}


function ImportHistory(userID, accessToken, isCRON){
    var period;
    return new Promise(function (resolve, reject){
        Limits.findOne({ID: 'main'}, function(err, config){
            if(err) console.log(err);
            if(isCRON) period = config.CRON_FETCH_PERIOD;
            else period = config.period;
            GetUserCalories(userID, accessToken, period).then(calories => {
                GetUserSteps(userID, accessToken, period).then(steps => {
                    GetUserDistance(userID, accessToken, period).then(distance => {
                        GetUserHeartRate(userID, accessToken, period).then(heart => {
                            if(calories && steps && distance && heart){
                                User.update({fitbitID: userID}, { err: false }, function(err){
                                    resolve({
                                        avgCals: config.calories,
                                        avgSteps: config.steps,
                                        avgDistance: config.distance,
                                        avgMinH: config.hmin,
                                        avgMaxH: config.hmax,
                                        calories: calories,
                                        steps: steps,
                                        distance: distance,
                                        heart: heart
                                    });
                                });
                            }
                            else{
                                console.log(calories, steps, distance, heart);
                                User.update({fitbitID: userID}, {
                                    err: true
                                }, function(err){
                                    reject(new Error('Undefined data, Or acesstoken/refreshtoken missed.'));
                                });
                            }
                        });
                    });
                });
            });
        });
    });
}

function GET_USER_DATA(fitbitID, isCRON){
    return new Promise(function(resolve, reject){
        User.findOne({fitbitID: fitbitID}, function(err, user){
            ImportHistory(user.fitbitID, user.accessToken, isCRON).then(data => {
                var tmpSteps = 0;
                var tmpCals = 0;
                var tmpDist = 0;
                var tmpHeart = 0;
                for(i = 0; i < data.calories.length; i++){
                    if(i == data.heart.length -1) restingHeart = 0;
                    else {
                        restingHeart = data.heart[i].value.restingHeartRate;
                        tmpHeart += Number(data.heart[i].value.restingHeartRate);
                    }
                    tmpSteps += Number(data.steps[i].value);
                    tmpCals += Number(data.calories[i].value);
                    tmpDist += Number(data.distance[i].value);

                    DataSchema.update({fitbitID: user.fitbitID, updatedAt: data.distance[i].dateTime},{
                        calories: data.calories[i].value,
                        steps: data.steps[i].value,
                        distance: data.distance[i].value,
                        heart: restingHeart
                    }, { upsert: true }, function(err){
                        if(err) console.log(err);
                    });
                }
                if( (tmpSteps / 7 < data.avgSteps)  || (tmpDist / 7 * 1000 < data.avgDistance) || (tmpCals / 7 < data.avgCals) || ( tmpHeart / 6 < data.avgMinH || tmpHeart / 6 > data.avgMaxH )){
                    resolve({is_Sedentary: true, fitbitID: user.fitbitID});
                    User.update({fitbitID: user.fitbitID}, {
                        sedentary: true
                    }, function(err){});
                }
                else{
                    resolve({is_Sedentary: false, fitbitID: user.fitbitID});
                    User.update({fitbitID: user.fitbitID}, {
                        sedentary: false
                    }, function(err){});
                }
                
            }, reject => {
            });
        });
    });
}


api.post('/importHistory', function(req, res){
    GET_USER_DATA(req.body.fitbitID, true).then(data => {
        if(!data.is_Sedentary){
            User.update({fitbitID: data.fitbitID}, {
                sedentary: false
            }, function(err){
                res.json({msg: 'ok'});
            });
        }
        else{
            User.update({fitbitID: data.fitbitID}, {
                sedentary: true
            }, function(err){
                res.json({msg: 'ok'});
            });
        }
        
    }, reject => {
        res.json({msg: 'fail'});
    });
});



api.get('/CRON_STATUS', function(req, res){
    res.json({
        REFRESH_TOKEN_JON: REFRESH_TOKEN_JON.running,
        SYNC_JOB: SYNC_JOB.running
    });
});


//////////////////////////////////API HERE /////////////////////////////
api.get('/listAllUsers', function(req, res){
    User.find({}, function(err, users){
        if(err) console.log(err);
        res.json(users);
    });
});
api.post('/searchByName', function(req, res){
    User.find({name: new RegExp(req.body.name, 'i')}, function(err, users){
        res.json(users);
    });
});
api.post('/userData/:fitbitID', function(req, res){
    var query = {};
    var end = req.body.end || null;
    var start = req.body.start || null;
    if(end && start){
        query.$lte = end;
        query.$gte = start;
    }
    else if(start){
        query.$gte = start;
    }
    var fitbitID = req.params.fitbitID;
    DataSchema.find({fitbitID: fitbitID, updatedAt: query}).sort('-updatedAt').exec(function(err, data){
        if(data && data.length)
            res.json(data);
        else res.json({data: []});
    });
});

api.post('/generate', function(req, res){
    var name = req.body.name;
    var fitbitID = req.body.fitbitID;
    var data = req.body.data;
    if(data.length > 0){
        var workbook = excelbuilder.createWorkbook(__dirname + '/reports/', data[0].fitbitID + '.xlsx');
        var sheet = workbook.createSheet('sheet', 10, 400); // Create a new worksheet with 10 columns and 12 rows
        sheet.set(1, 1, 'Name');
        sheet.set(2, 1, name);
        sheet.set(5, 1, 'FitBitID');
        sheet.set(6, 1, data[0].fitbitID);
        sheet.set(1, 3, 'Date');
        sheet.set(2, 3, 'Calories');
        sheet.set(3, 3, 'Steps');
        sheet.set(4, 3, 'Distance');
        data.forEach(function(item, index){
            sheet.set(1, 4 + index, item.updatedAt);
            sheet.set(2, 4 + index, item.calories);
            sheet.set(3, 4 + index, item.steps);
            sheet.set(4, 4 + index, item.distance);
        });
        workbook.save(function(ok){
            res.json({downLoadURL: '/reports/' + data[0].fitbitID + '.xlsx', msg: 'Done.'});
        });
    }
    else{
        console.log('No data');
        res.json({msg: 'No data.'});
    }
});
api.get('/reports/:file', function(req, res){
    console.log('requested file.');
    res.sendFile(path.join(__dirname, './reports', req.params.file));
});
api.get('/danger/deleteUser/:id', function(req,res){
    User.remove({fitbitID: req.params.id}, function(err){
        res.json({msg:'User completely deleted'});
    });
});
api.get('/danger/deleteData/:id', function(req,res){
    DataSchema.remove({fitbitID: req.params.id}, function(err){
        res.json({msg:'Data completely deleted'});
    });
});

api.post('/updateProfile', function(req, res){
    console.log(req.body.fitbitID);
    console.log(req.body.phone);
    console.log(req.body.email);
    console.log(req.body.operations);
    User.update({fitbitID: req.body.fitbitID }, {
        phone: req.body.phone,
        email: req.body.email,
        operations: req.body.operations
    }, function(err){
        if(err) console.log(err);
        res.json({msg: 'Updated!'});
    });
});

api.get('/UserErrors', function(req, res){
    User.find({err: true}, function(err, ErrorUsers){
        if(err) console.log(err);
        res.json(ErrorUsers);
    });
});
api.get('/SedentaryUsers', function(req, res){
    User.find({sedentary: true}, function(err, users){
        if(err) console.log(err);
        res.json(users);
    });
});
api.post('/sedentaryUserUpdate', function(req, res){
    var is_Sedentary = req.body.sedentary;
    User.update({fitbitID: req.body.fitbitID},{
        sedentary: is_Sedentary
    }, function(err){
        if(err) console.log(err);
        res.json({});
    });
});


//=====================SETTINGS PAGE ============//
api.post('/modifyLimits', function(req, res){
    var hmin = req.body.hmin;
    var hmax = req.body.hmax;
    var caloriesLimit = req.body.calories;
    var stepsLimit = req.body.steps;
    var distanceLimit = req.body.distance;
    Limits.update({ID: 'main'}, {
        hmin        : hmin,
        hmax        : hmax,
        calories    : caloriesLimit,
        steps       : stepsLimit,
        distance    : distanceLimit
    }, {
        upsert: true
    }, function(err){
        res.json({msg: 'Ok'});
    });
});

api.post('/setPeriod', function(req, res){
    Limits.update({ID: 'main'}, {
        period: req.body.period
    }, {
        upsert: true
    }, function(err){
        res.json({msg: 'Ok'});
    });
});

api.get('/getLimits', function(req, res){
    Limits.findOne({ID: 'main'}, function(err, limit){
        res.json(limit);
    });
});

exports.GET_USER_DATA           = GET_USER_DATA;
exports.REFRESH_TOKEN_JON       = REFRESH_TOKEN_JON;
exports.SYNC_JOB                = SYNC_JOB;
exports.api                     = api;