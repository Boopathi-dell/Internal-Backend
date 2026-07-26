const mongoose = require("mongoose");

const letterTemplateSchema = new mongoose.Schema({
  iqacNo: { type: String, default: "MEC/IQAC/2026-27/COE/" },
  examDescription: { type: String, default: "End Semester Examination - April/May-2026" },
  collegeTamilName: { type: String, default: "முத்தாயம்மால் பொறியியல் கல்லூரி, இராசிபுரம் – 637 408" },
  letterTitle: { type: String, default: "STATEMENT OF GRADES" },
  englishGreeting: { type: String, default: "Marks secured by your son / daughter in the {examDescription} are given below," },
  tamilGreeting: { type: String, default: "தேர்வில் தங்கள் மகன் / மகள் பெற்ற மதிப்பெண்கள் கீழே\nகொடுக்கப்பட்டுள்ள அட்டவணையில் குறிப்பிடப்பட்டுள்ளன." },
  noteEnglish: { type: String, default: "Candidates who secure less than 80 % of overall attendance in a semester will not be Permitted to write the End Semester Examinations." },
  noteTamil: { type: String, default: "கல்வியாண்டில் (ஒவ்வொரு செமஸ்டரிலும்) 80 சதவீதத்திற்கு குறைவாக வருகைப்பதிவு இருந்தால் அம்மாணவ, மாணவியர் இறுதி செமஸ்டர் தேர்வு எழுத அனுமதிக்கப்படமாட்டார்," },
  signatureLeft: { type: String, default: "MENTOR /\nCLASS ADVISOR" },
  signatureMiddle: { type: String, default: "HOD" },
  signatureRight: { type: String, default: "PRINCIPAL" },
  letterDate: { type: String, default: "" },
  columns: {
    type: Array,
    default: [
      { id: "1", header: "S. No.", type: "sno" },
      { id: "2", header: "Name of the Course", type: "courseName" },
      { id: "3", header: "Letter Grade", type: "grade", examName: "ESE" },
      { id: "4", header: "Result", type: "result", examName: "ESE" }
    ]
  }
}, { timestamps: true });

module.exports = mongoose.model("LetterTemplate", letterTemplateSchema);
