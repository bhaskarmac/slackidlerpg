const express = require('express');
const bodyParser = require('body-parser')

const Idle = require('./idle');
const logger = require('./logger');

const API_PORT = process.env.API_PORT || 8010;
const idle = new Idle();

var app = express();
// app.use(require('morgan')('dev')); // scroll access logs
// This is insane
app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())

// Listen for events from Slack
app.post('/action', (req, res) => {

  if (req.body && req.body.challenge) {
    res.json({"challenge":req.body.challenge});
    return;
  }

  idle.handleEvent(req.body);

  res.send('ok');
});

// Listens for the /idle command
app.post('/idle', (req, res) => {
  logger.info(`/idle body: ${JSON.stringify(req.body)}`);

  idle.handleCommand(req.body)
  .then(result => {
    res.send(result);
  });
});

// Listens for the /idlereset command
app.post('/reset', (req, res) => {
  logger.info(`/reset body: ${JSON.stringify(req.body)}`);

  idle.handleCommand(req.body)
  .then(result => {
    res.send(result);
  });
});

// OAuth for distribution
app.get('/authorize', (req, res) => {
  logger.info(`Request query: ${JSON.stringify(req.query)}`);

  if (!req.query) {
    res.send('Query missing.');
    return;
  }
  if (!req.query.code) {
    res.send('OAuth code missing.');
    return;
  }

  idle.authorize(req.query.code)
  .then((response) => {
    res.send(response);
  });
});

// start server
app.listen(API_PORT, function () {
  logger.info(`Listening on ${API_PORT}`);
})

// start loop
idle.start();
