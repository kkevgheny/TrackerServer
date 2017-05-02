var mongoose    = require('mongoose');
mongoose.connect('mongodb://fitnesstrackerdb:9Xmn6cIGgDE1hUk0EZm5yXC1uZ0YmQh0YBxfYA786sBzPtHUgCPcNeltd4AO14hy4Fk0v0bWumP6B3g4B7KDpQ==@fitnesstrackerdb.documents.azure.com:10250/?ssl=true');
//mongoose.connect('mongodb://instagib:Iamtheone1@ds161190.mlab.com:61190/fitbit');
var db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function() {
  console.log('Connected to db!');
});


var userSchema = mongoose.Schema({
    updatedAt: Date,
    name: String,
    phone: String,
    email: String,
    operations: String,
    profile: {},
    fitbitID: String,
    accessToken: String,
    refreshToken: String
});
var User = mongoose.model('users', userSchema);

var userDataSchema = mongoose.Schema({
  fitbitID: String,
  updatedAt: String,
  calories: Number,
  steps: Number,
  distance: Number,
});
var DataSchema = mongoose.model('data', userDataSchema);

var limitsSchema = mongoose.Schema({
  ID: String,
  calories: Number,
  steps: Number,
  distance: Number,
  period: String
});
var Limits              = mongoose.model('limits', limitsSchema);

exports.DataSchema      = DataSchema;
exports.Limits          = Limits;
exports.User            = User;