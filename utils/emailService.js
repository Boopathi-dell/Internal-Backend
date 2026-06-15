const nodemailer = require("nodemailer");

const sendEmail = async (to, subject, htmlContent) => {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER || "boopathi.mec.cse@gmail.com",
        pass: process.env.EMAIL_PASS, // Needs App Password in .env
      },
    });

    const mailOptions = {
      from: process.env.EMAIL_USER || "boopathi.mec.cse@gmail.com",
      to,
      subject,
      html: htmlContent,
    };

    if (!process.env.EMAIL_PASS) {
      console.log("Email Simulation (No EMAIL_PASS provided in .env):");
      console.log(`To: ${to}\nSubject: ${subject}\n`);
      return { success: true, simulated: true };
    }

    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent: " + info.response);
    return { success: true, info };
  } catch (error) {
    console.error("Error sending email:", error);
    return { success: false, error };
  }
};

module.exports = sendEmail;
