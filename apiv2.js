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
    cronTime: '* 8,20 * * *',
    //cronTime: '* * * * *',
    onTick: function(){
        User.find({}, function(err, users){
            if(err) console.log(err);
            users.forEach(user => {
                GetUserSteps(user.fitbitID, user.accessToken).then(steps => {
                    GetUserCalories(user.fitbitID, user.accessToken).then(calories => {
                        GetUserDistance(user.fitbitID, user.accessToken).then(distance => {
                            GetUserHeartRate(user.fitbitID, user.accessToken).then(heartrate => {
                                DataSchema.update({fitbitID: user.fitbitID, updatedAt: distance[0].dateTime}, {
                                    distance: distance[0].value,
                                    calories: calories[0].value,
                                    steps: steps[0].value,
                                }, {upsert: true}, function(err){
                                    if(err) console.log(err);
                                });
                            });
                        });
                    });
                });
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


function ImportHistory(userID, accessToken, period){
    return new Promise(function (resolve, reject){
        GetUserCalories(userID, accessToken, period).then(calories => {
            GetUserSteps(userID, accessToken, period).then(steps => {
                GetUserDistance(userID, accessToken, period).then(distance =>{
                    GetUserHeartRate(userID, accessToken, period).then(heartrate => {
                        if(calories && steps && distance && heartrate){
                            User.update({fitbitID: userID}, {
                                err: false
                            }, function(err){
                                resolve({
                                    heart: heartrate,
                                    calories: calories,
                                    steps: steps,
                                    distance: distance
                                });
                            });
                        }
                        else {
                            User.update({fitbitID: userID}, {
                                err: true
                            }, function(err){
                                reject(new Error('Undefined data.'));
                            });
                        };
                    });
                });
            });
        });
    });
}

api.post('/importHistory', function(req, res){
    User.findOne({fitbitID: req.body.fitbitID}, function(err, user){
        if(err) console.log(err);
        Limits.findOne({ID: 'main'}, function(err, config){
            if(err) console.log(err);
            ImportHistory(user.fitbitID, user.accessToken, config.period).then(data =>{
                DataSchema.remove({fitbitID: user.fitbitID}, function(err){
                    data.calories.forEach(calories => {
                        DataSchema.update({fitbitID: user.fitbitID, updatedAt: calories.dateTime}, {
                            calories: calories.value,
                        }, {
                            upsert: true
                        }, function(err){});
                    });
                    data.steps.forEach(steps => {
                        DataSchema.update({fitbitID: user.fitbitID, updatedAt: steps.dateTime}, {
                            steps: steps.value,
                        }, {
                            upsert: true
                        }, function(err){});
                    });
                    data.distance.forEach(distance => {
                        DataSchema.update({fitbitID: user.fitbitID, updatedAt: distance.dateTime}, {
                            distance: distance.value,
                        }, {
                            upsert: true
                        }, function(err){});
                    });
                    data.heart.forEach(heart => {
                        DataSchema.update({fitbitID: user.fitbitID, updatedAt: heart.dateTime}, {
                            heart: heart.value.restingHeartRate,
                        }, {
                            upsert: true
                        }, function(err){});
                    });
                    res.json({msg: 'Done importHistory'});
                });
            }, err => {
                res.json({msg: false});
            });
        });
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

exports.ImportHistory           = ImportHistory;
exports.REFRESH_TOKEN_JON       = REFRESH_TOKEN_JON;
exports.SYNC_JOB                = SYNC_JOB;
exports.api                     = api;