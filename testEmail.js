require('dotenv').config();
const sendEmail = require('./utils/emailService');

sendEmail('boopathi.mec.cse@gmail.com', 'Test Mail', 'Testing from Node')
  .then(console.log)
  .catch(console.error);
