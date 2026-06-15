const nodemailer = require("nodemailer");

const sendCorrectionNotification = async (requestData, adminEmail) => {
  if (!adminEmail) {
    console.log("No admin email configured for this year. Skipping email notification.");
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: adminEmail,
      subject: `New Mark Correction Request: ${requestData.subjectName} (${requestData.studentRegNo})`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px;">Mark Correction Request</h2>
          
          <div style="background-color: #f8fafc; padding: 15px; border-radius: 6px; margin: 20px 0;">
            <p><strong>Student Name:</strong> ${requestData.studentName}</p>
            <p><strong>Registration No:</strong> ${requestData.studentRegNo}</p>
            <p><strong>Class Details:</strong> ${requestData.className}</p>
            <p><strong>Exam Name:</strong> ${requestData.examName}</p>
            <p><strong>Subject:</strong> ${requestData.subjectName} (${requestData.subjectCode})</p>
            <p><strong>Current Mark:</strong> <span style="color: #ef4444; font-weight: bold;">${requestData.currentMark}</span></p>
          </div>

          <h3 style="color: #333;">Student's Reason:</h3>
          <div style="background-color: #fffbeb; padding: 15px; border-left: 4px solid #f59e0b; border-radius: 4px; font-style: italic;">
            "${requestData.reason}"
          </div>

          <p style="margin-top: 30px; font-size: 0.9em; color: #64748b;">
            Please log in to the Result Analysis Admin Panel to review and process this request.
          </p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Notification email sent successfully to ${adminEmail}`);
  } catch (error) {
    console.error("Error sending email notification:", error);
  }
};

module.exports = { sendCorrectionNotification };
