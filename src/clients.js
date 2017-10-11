var WebClient = require('@slack/client').WebClient;

function Clients() {
  this.clients = {};
};

Clients.prototype.client = function client(token) {
  if (this.clients[token] === undefined) {
    const client = new WebClient(token);
    this.clients[token] = client;
  }

  return this.clients[token];
}

module.exports = Clients;