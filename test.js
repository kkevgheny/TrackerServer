var Promise = require('promise');


function count(){
    return new Promise(function(resolve, reject){
        var cnt = 0;
        for(var i=0; i < 1000; i++){
            cnt += i;
        }
        return resolve(cnt);
    });
}

function iterate(){
    for (var i = 0; i < 100; i++){
        if(i % 2 == 0) console.log(i);
    }
}


count().then(function(res){
    console.log(res);
    iterate();
});
