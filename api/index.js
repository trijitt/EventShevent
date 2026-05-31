const { handleRequest } = require("../server");

module.exports = function handler(req, res) {
  return handleRequest(req, res, { apiOnly: true });
};
