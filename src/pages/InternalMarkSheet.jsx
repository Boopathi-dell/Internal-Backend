import React, { useState, useEffect } from "react";
import API from "../api";
import { Search, Printer, AlertTriangle } from "lucide-react";
import * as XLSX from "xlsx";

export default function InternalMarkSheet() {
  const [formData, setFormData] = useState({
    department: "CSE",
    year: "IV",
    semester: "VII",
    section: "A",
    academicYear: "2025-26" // default from user's image
  });
  
  const [template, setTemplate] = useState(null);
  const [studentsData, setStudentsData] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(false);
  
  useEffect(() => {
    fetchActiveTemplate();
  }, []);
  
  const fetchActiveTemplate = async () => {
    try {
      const res = await API.get("/api/internal-marks/active");
      if (res.data) setTemplate(res.data);
    } catch (err) {
      console.error(err);
    }
  };
  
  const handleFetch = async () => {
    if (!template) {
      alert("No active template found. Please ask Admin to set an Internal Mark Template.");
      return;
    }
    
    setLoading(true);
    try {
      // We need to fetch all classes for this Year/Sem/Sec/Dept
      const yearSemSec = `${formData.year}/${formData.semester}/${formData.section}`;
      const res = await API.get(`/api/classes?department=${formData.department}&yearSemSec=${yearSemSec}`);
      const classes = res.data;
      
      if (classes.length === 0) {
        alert("No class data found for this selection.");
        setStudentsData([]);
        setSubjects([]);
        setLoading(false);
        return;
      }
      
      // We want to generate internal marks per student per subject
      // In the image, the table has "Name of the Subject" spanning across the columns.
      // Wait, the image shows: S.No | Register No. | Name of the Students | (Template Columns) | TOTAL
      // Then below "Register No" it says "Name of the Students" but actually each row is a student.
      // And the image has:
      // Row 10: S.No | Register No. | Name of the Students | UNIT (30) | ... | TOTAL
      // But it also says "Name of the Subject: " at the top? No, "Name of the Subject" is in Row 10 Column C, and "Name of the Students" in Row 11 Column C.
      // This implies the sheet is for ONE specific subject!
      // Wait, let's look at the image closely.
      // Department: CSE, Year/Sem/Sec: IV/VII/
      // Name of the Subject: [Blank in image?] No, row 10 has "Name of the Subject", row 11 has "Name of the Students". Wait, this is a single subject's internal mark sheet! 
      // Look at the columns: Unit 1, Unit 2, CIA 1, Unit 3, Unit 4, CIA 2, Unit 5, CIA 3, SEMINAR, MKC. This is exactly how marks are calculated for ONE subject.
      
      // So the user needs to select Subject as well!
      // But currently, `Class` model in backend stores all data for ONE subject. A `Class` document is basically one subject for one Year/Sem/Sec.
      
      setSubjects(classes); // classes are actually subjects in this app
      
      // If we just fetched multiple subjects, maybe we should let them select one.
      if (classes.length > 0) {
        setFormData(prev => ({ ...prev, selectedClassId: classes[0]._id }));
        processSubjectData(classes[0], template);
      } else {
        setStudentsData([]);
      }
    } catch (err) {
      console.error(err);
      alert("Failed to fetch data.");
    }
    setLoading(false);
  };
  
  const processSubjectData = async (subjectClass, currentTemplate) => {
    // subjectClass contains students array. Each student has 'marks' array.
    // However, subjectClass only represents ONE exam (like CIA I).
    // WAIT. In this app, a "Class" document represents ONE EXAM for ONE SUBJECT for ONE Year/Sem/Sec?
    // Let's recall `Class.js`: className, subjects (array), targetPassPercentage, examName.
    // If a faculty creates "CIA I" for "AI&DS IV/VII/A", it's one Class document.
    // To get all exams for the same subject, we need to find all Class documents with the same `subjects[0]` (or className pattern) and same yearSemSec.
    
    try {
      // Find all classes (exams) for this Year/Sem/Sec and Department
      const yearSemSec = `${formData.year}/${formData.semester}/${formData.section}`;
      const res = await API.get(`/api/classes?department=${formData.department}&yearSemSec=${yearSemSec}`);
      const allClasses = res.data;
      
      // Since `className` usually looks like "CSE II/IV/A - Java - CIA I"
      // We need to group them by Subject.
      // Actually, subjects is `subjects: ["Java"]`. So we can group by `subjects[0]`.
      
      // Filter for the selected subject
      const selectedSubjectClasses = allClasses.filter(c => c.subjects && c.subjects[0] === formData.selectedSubject);
      
      // If no selected subject, just use the first one available
      const subjectToProcess = formData.selectedSubject || (allClasses.length > 0 && allClasses[0].subjects ? allClasses[0].subjects[0] : null);
      if (!subjectToProcess) return;
      
      const subjectExams = allClasses.filter(c => c.subjects && c.subjects[0] === subjectToProcess);
      
      // Build a map of student RegNo -> { name, exams: { "CIA I": 45, "UNIT I": 25, ... } }
      const studentMap = {};
      
      subjectExams.forEach(examObj => {
        const examName = examObj.examName;
        examObj.students.forEach(student => {
          if (!studentMap[student.regNo]) {
            studentMap[student.regNo] = {
              regNo: student.regNo,
              name: student.name,
              exams: {}
            };
          }
          // Assuming marks[0] is the mark for the subject
          const markVal = student.marks && student.marks.length > 0 ? student.marks[0] : "AB";
          studentMap[student.regNo].exams[examName] = markVal;
        });
      });
      
      // Calculate formula values
      const evaluatedStudents = Object.values(studentMap).map(student => {
        const row = { ...student };
        let finalTotal = 0;
        
        currentTemplate.columns.forEach(col => {
          if (col.type === "exam") {
            row[col.heading] = student.exams[col.examName] || 0;
          } else if (col.type === "formula") {
            try {
              let formulaStr = col.formula;
              // replace #[Column Heading] with actual values
              currentTemplate.columns.forEach(innerCol => {
                const val = row[innerCol.heading] || 0;
                // handle "AB" or "NA" as 0 in formulas
                const numVal = isNaN(Number(val)) ? 0 : Number(val);
                formulaStr = formulaStr.split(`#[${innerCol.heading}]`).join(numVal);
              });
              // Evaluate formula securely
              // Example formula: (10 + 20) / 110 * 10
              const evaluated = new Function(`return ${formulaStr}`)();
              row[col.heading] = Math.round(evaluated);
            } catch (e) {
              row[col.heading] = 0;
            }
          }
          
          // Identify if it's the TOTAL column (could just sum all IM columns, but let's assume TOTAL is calculated via formula, or we sum last column)
        });
        
        // If there's a column exactly named "TOTAL(40)" or similar, we don't need a hardcoded sum.
        return row;
      });
      
      // Sort by regNo
      evaluatedStudents.sort((a, b) => a.regNo.localeCompare(b.regNo));
      
      setStudentsData(evaluatedStudents);
      
    } catch(err) {
      console.error(err);
    }
  };
  
  // Need to update when subject changes
  const handleSubjectChange = async (subjectName) => {
    setFormData(prev => ({ ...prev, selectedSubject: subjectName }));
    if (template) {
      await processSubjectData({ ...formData, selectedSubject: subjectName }, template);
    }
  };
  
  // We need to fetch all distinct subjects for the selected Year/Sem/Sec
  const fetchSubjectsForSelection = async () => {
    try {
      const yearSemSec = `${formData.year}/${formData.semester}/${formData.section}`;
      const res = await API.get(`/api/classes?department=${formData.department}&yearSemSec=${yearSemSec}`);
      const allClasses = res.data;
      
      const distinctSubjects = [...new Set(allClasses.map(c => c.subjects && c.subjects[0]).filter(Boolean))];
      setSubjects(distinctSubjects);
      
      if (distinctSubjects.length > 0) {
        setFormData(prev => ({ ...prev, selectedSubject: distinctSubjects[0] }));
      } else {
        setFormData(prev => ({ ...prev, selectedSubject: "" }));
      }
    } catch(e) { console.error(e); }
  };
  
  useEffect(() => {
    fetchSubjectsForSelection();
  }, [formData.department, formData.year, formData.semester, formData.section]);
  
  useEffect(() => {
    if (formData.selectedSubject && template) {
      processSubjectData(formData, template);
    }
  }, [formData.selectedSubject, template]);


  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="card">
      <div className="no-print">
        <h2 style={{ marginBottom: "1rem" }}>Internal Mark Sheet Generator</h2>
        
        {!template && (
          <div style={{ background: "rgba(239,68,68,0.1)", padding: "1rem", borderRadius: "8px", color: "var(--danger)", display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
            <AlertTriangle size={20} />
            <strong>No active template found!</strong> Please ask the Administrator to configure an Internal Mark Template in the Admin Panel.
          </div>
        )}

        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1.5rem", background: "var(--bg-secondary)", padding: "1rem", borderRadius: "8px" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Academic Year</label>
            <input type="text" className="input-field" value={formData.academicYear} onChange={e => setFormData({...formData, academicYear: e.target.value})} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Department</label>
            <select className="input-field" value={formData.department} onChange={e => setFormData({...formData, department: e.target.value})}>
              {["CSE", "AI&DS", "ECE", "EEE", "MECH", "CIVIL", "IT"].map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Year</label>
            <select className="input-field" value={formData.year} onChange={e => setFormData({...formData, year: e.target.value})}>
              {["I", "II", "III", "IV"].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Semester</label>
            <select className="input-field" value={formData.semester} onChange={e => setFormData({...formData, semester: e.target.value})}>
              {["I", "II", "III", "IV", "V", "VI", "VII", "VIII"].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Section</label>
            <select className="input-field" value={formData.section} onChange={e => setFormData({...formData, section: e.target.value})}>
              {["A", "B", "C", "D"].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Subject</label>
            <select className="input-field" value={formData.selectedSubject || ""} onChange={e => handleSubjectChange(e.target.value)}>
              {subjects.length === 0 && <option value="">No subjects found</option>}
              {subjects.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button onClick={handlePrint} className="btn btn-primary" disabled={!template || studentsData.length === 0}>
              <Printer size={18} style={{ marginRight: "0.5rem" }} /> Print Landscape
            </button>
          </div>
        </div>
      </div>

      {/* PRINTABLE AREA */}
      {template && studentsData.length > 0 && (
        <div className="printable-internal-mark">
          <style>{`
            @media print {
              @page { size: landscape; margin: 10mm; }
              body * { visibility: hidden; }
              .printable-internal-mark, .printable-internal-mark * { visibility: visible; }
              .printable-internal-mark { position: absolute; left: 0; top: 0; width: 100%; color: #000; }
              .no-print { display: none !important; }
              table { border-collapse: collapse; width: 100%; font-size: 11px; }
              th, td { border: 1px solid #000 !important; padding: 4px; text-align: center; }
              th { font-weight: bold; }
              .header-text { text-align: center; font-family: 'Times New Roman', serif; margin-bottom: 15px; }
              .header-text h1 { font-size: 20px; font-weight: bold; margin: 0; }
              .header-text h3 { font-size: 14px; font-weight: bold; margin: 5px 0; }
              .header-text p { font-size: 12px; margin: 2px 0; }
            }
            .internal-mark-table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 12px; color: #000; background: #fff; }
            .internal-mark-table th, .internal-mark-table td { border: 1px solid #000; padding: 6px; text-align: center; }
            .internal-mark-table th { font-weight: bold; background: #f8f9fa; color: #000; }
            .text-left { text-align: left !important; }
          `}</style>

          <div className="header-text" style={{ textAlign: "center", color: "#000", fontFamily: "Times New Roman, serif" }}>
            <h1 style={{ fontSize: "24px", margin: "0", fontWeight: "bold" }}>MUTHAYAMMAL ENGINEERING COLLEGE</h1>
            <p style={{ margin: "5px 0", fontSize: "14px", fontWeight: "bold" }}>(An Autonomous Institution)</p>
            <p style={{ margin: "2px 0", fontSize: "12px" }}>(Approved by AICTE, New Delhi, Accredited by NAAC & Affiliated to Anna University)</p>
            <p style={{ margin: "2px 0", fontSize: "12px" }}>Rasipuram - 637 408, Namakkal Dist., Tamil Nadu</p>
            
            <h3 style={{ marginTop: "15px", fontSize: "16px", fontWeight: "bold" }}>OFFICE OF THE CONTROLLER OF THE EXAMINATION</h3>
            <h3 style={{ margin: "5px 0", fontSize: "14px", fontWeight: "bold" }}>ACADEMIC YEAR {formData.academicYear} (ODD SEMESTER)</h3>
            <h3 style={{ margin: "5px 0", fontSize: "14px", fontWeight: "bold", textDecoration: "underline" }}>INTERNAL MARK SHEET</h3>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "20px", fontWeight: "bold", color: "#000", fontSize: "14px" }}>
            <div>Department : {formData.department}</div>
            <div>Year / Sem / Sec : {formData.year}/{formData.semester}/{formData.section}</div>
          </div>

          <table className="internal-mark-table">
            <thead>
              <tr>
                <th rowSpan="2" style={{ width: "40px" }}>S.No</th>
                <th rowSpan="2" style={{ width: "100px" }}>Register No.</th>
                <th className="text-left" style={{ minWidth: "200px" }}>Name of the Subject: {formData.selectedSubject}</th>
                {template.columns.map((col, idx) => (
                  <th key={idx} rowSpan="2">{col.heading}</th>
                ))}
              </tr>
              <tr>
                <th className="text-left">Name of the Students</th>
              </tr>
            </thead>
            <tbody>
              {studentsData.map((student, idx) => (
                <tr key={student.regNo}>
                  <td>{idx + 1}</td>
                  <td>{student.regNo}</td>
                  <td className="text-left">{student.name}</td>
                  {template.columns.map((col, colIdx) => (
                    <td key={colIdx}>
                      {student[col.heading] !== undefined ? student[col.heading] : "-"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
