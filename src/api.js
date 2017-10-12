const express = require('express');
const bodyParser = require('body-parser')

const Idle = require('./idle');

const API_PORT = process.env.API_PORT || 8080;
const idle = new Idle();

var app = express();
app.use(require('morgan')('dev')); // scroll access logs
// This is insane
app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())

// Listen for events from Slack
app.post('/action', (req, res) => {
  console.log(`/action body: ${JSON.stringify(req.body)}`);

  if (req.body && req.body.challenge) {
    res.json({"challenge":req.body.challenge});
    return;
  }

  idle.handleEvent(req.body);

  res.send('ok');
});

// Listens for the /idle command
app.post('/idle', (req, res) => {
  console.log(`/idle body: ${JSON.stringify(req.body)}`);

  idle.handleCommand(req.body)
  .then(result => {
    res.send(result);
  });
});

// start server
app.listen(API_PORT, function () {
  console.log(`Listening on ${API_PORT}`);
})

// start loop
idle.start();
