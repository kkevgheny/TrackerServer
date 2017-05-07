var express             = require('express');
var app                 = express();
var User                = require('./db').User;
var REFRESH_TOKEN_JON   = require('./api').REFRESH_TOKEN_JON;
var SYNC_JOB            = require('./api').SYNC_JOB;
var api                 = require('./api').api;
var GET_USER_DATA       = require('./api').GET_USER_DATA;
var cors                = require('cors');

var expressSession  = require('express-session');
var bodyParser      = require('body-parser');
var passport        = require('passport');
var FitbitStrategy  = require('passport-fitbit-oauth2').FitbitOAuth2Strategy;

var port = process.env.PORT || 80;

app.use(cors());
app.use('/landing', express.static('views/assets'));
app.use(express.static('dist'));

app.use(bodyParser.json());
app.use(expressSession({secret: 'mySecretKey'}))
app.use(passport.initialize());
app.use(passport.session());
passport.serializeUser(function(user, done) {
  done(null, user);
});
passport.deserializeUser(function(id, done) {
  done(null, null);
});
passport.use('fitbit', new FitbitStrategy({
    clientID:     '2289DH',
    clientSecret: '5fb5478a042b719140bb2e460331bb17',
    callbackURL: "http://nsurg.webify.tech/auth/fitbit/callback"
  },
  function(accessToken, refreshToken, profile, done) {
    GET_USER_DATA(profile.id, false).then(() => {
        console.log('Importing history');
    });
    User.find({fitbitID: profile.id}, function(err, user){
        if(!user.length) {
            var user = new User({
                    name        : profile._json.user.fullName,
                    profile     : profile,
                    fitbitID    : profile.id,
                    accessToken : accessToken,
                    refreshToken: refreshToken
                }).save(function(err){
                    if(err) console.log(err);
                });
            }
            return done(err, {
                accessToken: accessToken,
                refreshToken: refreshToken,
                profile: profile
            });
        });
    }
));


app.use('/api', api);
app.get('/landing', function(req, res){
    res.sendFile(__dirname + '/views/register.html');
});

app.get('/auth/fitbit',
  passport.authenticate('fitbit', { scope: [
      'activity','heartrate','location','profile', 'settings', 'sleep', 'weight'
      ]}
));
app.get('/auth/fitbit/callback', passport.authenticate('fitbit', {
    successRedirect: '/auth/fitbit/success',
    failureRedirect: '/auth/fitbit/failure'
}));
app.get('/auth/fitbit/success', function(req, res){
    res.sendFile(__dirname + '/views/success.html');
});
app.get('/auth/fitbit/failure', function(req, res){
    res.sendFile(__dirname + '/views/failure.html');
});


app.get('/', function(req, res){
    res.sendFile(__dirname + '/dist/app.html');
});
app.get('*', function(req, res){
    res.redirect('/');
});
app.listen(port, function() {
    REFRESH_TOKEN_JON.start();
    SYNC_JOB.start();
    console.log('Our app is running on http://localhost:' + port);
});