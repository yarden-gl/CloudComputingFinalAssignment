'use strict';
const express = require('express');
const path = require('path');
const AWS = require("aws-sdk");
const app = express();
const port = 3000;
const bodyParser = require('body-parser');
const { resolve } = require('path');
const bucketName = "certified-voters-data";
const fileName = "certified-voters.json";
const streamName = "FFDataStream";

var arrVotes = []; // array of records where each record is a valid vote
var electionCount = []; // array of length 3, where each element is sum of votes for nominee in index i

AWS.config.getCredentials(function (err) {
    if (err) console.log(err.stack);
    // credentials not loaded
    else {
        console.log("Credentials loaded");
    }
});

AWS.config.update({region: 'us-east-1'});
var s3 = new AWS.S3({
    apiVersion: '2006-03-01',
    params: {Bucket: bucketName}
  });

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));

app.get('/', (req,res)=>{
    res.sendFile(path.join(__dirname + '/public/main.html'));
})

app.get('/public/main.html', (req, res)=>{
    run();
    res.send(electionCount)
})

app.post('/public/main.html', (req, res)=>{
    var id = req.body['Id'];
    var valid = false;
    if(unique(id)) {
        // Checks with the certified voters file in S3 that voter is valid
        s3.listObjects({}, function(err, data) {
            if(!err) {
              var params = {Bucket: bucketName, Key: fileName};
              s3.getObject(params, function(err, data) {  // data = certified-voters.json
                  if (err) 
                    console.log(err, err.stack);
                  else {
                    var certifiedData = data.Body.toString('utf-8');
                    valid = certifiedData.includes(id);
                    let vote = {Candidate: req.body['Candidate'] , Id: req.body['Id'], Gender: req.body['Gender'] ,
                    CatOwner: req.body['CatOwner']  ,Time: req.body['Time'], Valid: valid};

                    upload(JSON.stringify(vote));

                    let value = valid ? "Congratulations! Your vote has been registered" : "ID is invalid";
                    res.send({text: value});
                  }
              });
            }
        });
    } else {
        let vote = {Candidate: req.body['Candidate'] , Id: req.body['Id'], Gender: req.body['Gender'] ,
                    CatOwner: req.body['CatOwner']  ,Time: req.body['Time'], Valid: valid};

                    upload(JSON.stringify(vote));

        res.send({text:"Your vote is already registered"});
    }
});

function run() {
    var kinesis = new AWS.Kinesis();
    kinesis.describeStream({
        StreamName: streamName
    }, function (err, streamData) {
        if (err) {
            console.log(err, err.stack); // an error occurred
        } else {
            console.log(streamData); // successful response
            streamData.StreamDescription.Shards.forEach(shard => {
                kinesis.getShardIterator({
                    ShardId: shard.ShardId,
                    ShardIteratorType: 'TRIM_HORIZON',
                    StreamName: streamName
                }, function (err, shardIteratordata) {
                    if (err) {
                        console.log(err, err.stack); // an error occurred
                    } else {
                        console.log(shardIteratordata); // successful response
                        kinesis.getRecords({
                            ShardIterator: shardIteratordata.ShardIterator
                        }, function (err, recordsData) {
                            if (err) {
                                console.log(err, err.stack); // an error occurred
                            } else {
                                // Tallying all valid votes from Kinesis stream
                                electionCount = [0,0,0];
                                
                                recordsData.Records.forEach(record => {
                                    let recordJson = JSON.parse(record.Data.toString());
                                    if(recordJson.Valid) {
                                        electionCount[recordJson.Candidate - 1]++;
                                        arrVotes.push(recordJson);
                                    }
                                });
                            }
                        });
                    }
                });
            });
        }
    });
}

/**
 * 
 * Upload new vote to Kinesis Stream
 */
function upload(vote){
    var kinesis = new AWS.Kinesis();
    kinesis.putRecord({
        Data: Buffer.from(vote),
        PartitionKey: 'Id',
        StreamName: streamName
    }, function(err, data) {
        if (err) {
            console.log(err, err.stack); // an error occurred
        } else {
            console.log(data); // successful response
        }
    });
}

/**
 * 
 * Check that given ID hasn't already been used to cast a vote
 */
function unique(id) {
    var isUnique = true;
    arrVotes.forEach(vote => {
        if(vote.Id === id) {
            isUnique = false;
        }

    });
    return isUnique;
}

app.listen(port, () => console.log(`app listening at http://localhost:${port}`));