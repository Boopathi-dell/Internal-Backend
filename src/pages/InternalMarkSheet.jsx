import React, { useState, useEffect } from "react";
import API from "../api";
import { Search, Printer, AlertTriangle, FileSpreadsheet, CheckCircle2, Type } from "lucide-react";

export default function InternalMarkSheet() {
  const [formData, setFormData] = useState({
    regulation: "2021",
    academicYear: "2025-26",
    department: "CSE",
    year: "IV",
    semester: "VII",
    section: "A",
    selectedSubject: "",
    customSubject: "",
    isCustomSubject: false,
  });
  
  const [template, setTemplate] = useState(null);
  const [studentsData, setStudentsData] = useState([]);
  const [subjects, setSubjects] = useState([]); // array of objects { code, name }
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [rosters, setRosters] = useState([]);
  
  useEffect(() => {
    if (formData.regulation) {
      fetchActiveTemplate(formData.regulation);
    }
  }, [formData.regulation]);

  useEffect(() => {
    fetchAllRosters();
  }, []);
  
  const fetchActiveTemplate = async (reg) => {
    try {
      const res = await API.get(`/api/internal-marks/active?regulation=${reg}`);
      if (res.data) setTemplate(res.data);
      else { 
        setTemplate(null);
        setErrorMsg(`No active template found for Regulation ${reg}.`); 
      }
    } catch (err) {
      console.error(err);
      setErrorMsg("Failed to fetch template.");
    }
  };

  const fetchAllRosters = async () => {
    try {
      const res = await API.get("/api/rosters");
      setRosters(res.data);
    } catch (err) {
      console.error("Failed to fetch rosters");
    }
  };
  
  const processSubjectData = async (config, currentTemplate) => {
    setLoading(true);
    try {
      const yearSemSec = `${config.year}/${config.semester}/${config.section}`;
      const res = await API.get(`/api/classes`);
      
      const allClasses = res.data.filter(c => 
        c.department === config.department && 
        c.yearSemSec === yearSemSec
      );
      
      const subjectToProcess = config.isCustomSubject ? config.customSubject : config.selectedSubject;
      
      if (!subjectToProcess) {
        setStudentsData([]);
        setLoading(false);
        return;
      }
      
      const subjectExams = allClasses.filter(c => c.subjects && c.subjects[0] === subjectToProcess);
      
      const studentMap = {};

      // 1. Initialize map from Roster so we get ALL students even if 0 marks uploaded
      const matchingRoster = rosters.find(r => 
        r.department === config.department && 
        r.year === config.year && 
        r.semester === config.semester && 
        r.section === config.section
      );

      if (matchingRoster && matchingRoster.students) {
        matchingRoster.students.forEach(student => {
          studentMap[student.regNo] = {
            regNo: student.regNo,
            name: student.name,
            exams: {}
          };
        });
      }
      
      // 2. Populate with actual exam marks if they exist
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
          const markVal = student.marks && student.marks.length > 0 ? student.marks[0] : "AB";
          studentMap[student.regNo].exams[examName] = markVal;
        });
      });
      
      // 3. Evaluate formulas
      const evaluatedStudents = Object.values(studentMap).map(student => {
        const row = { ...student };
        
        currentTemplate.columns.forEach(col => {
          if (col.type === "exam") {
            row[col.heading] = student.exams[col.examName] || 0;
          } else if (col.type === "formula" || col.type === "calculation") {
            try {
              let formulaStr = col.formula;
              // Provide fallback if formula string is empty
              if (!formulaStr) formulaStr = "0";

              currentTemplate.columns.forEach(innerCol => {
                const val = row[innerCol.heading] || 0;
                const numVal = isNaN(Number(val)) ? 0 : Number(val);
                formulaStr = formulaStr.split(`#[${innerCol.heading}]`).join(numVal);
              });
              const evaluated = new Function(`return ${formulaStr}`)();
              row[col.heading] = isNaN(evaluated) ? 0 : Math.round(evaluated);
            } catch (e) {
              row[col.heading] = 0;
            }
          }
        });
        
        return row;
      });
      
      evaluatedStudents.sort((a, b) => a.regNo.localeCompare(b.regNo));
      setStudentsData(evaluatedStudents);
      
    } catch(err) {
      console.error(err);
    }
    setLoading(false);
  };
  
  const handleSubjectDropdownChange = (e) => {
    const val = e.target.value;
    if (val === "CUSTOM") {
      setFormData(prev => ({ ...prev, selectedSubject: "CUSTOM", isCustomSubject: true }));
    } else {
      setFormData(prev => ({ ...prev, selectedSubject: val, isCustomSubject: false, customSubject: "" }));
    }
  };

  const handleCustomSubjectChange = (e) => {
    setFormData(prev => ({ ...prev, customSubject: e.target.value }));
  };
  
  const fetchSubjectsForSelection = async () => {
    try {
      const yearSemSec = `${formData.year}/${formData.semester}/${formData.section}`;
      const res = await API.get(`/api/classes`);
      
      const filteredClasses = res.data.filter(c => 
        c.department === formData.department && 
        c.yearSemSec === yearSemSec
      );
      
      const distinctSubjectCodes = [...new Set(filteredClasses.map(c => c.subjects && c.subjects[0]).filter(Boolean))];
      
      // Build a map of courseCode -> courseName from courseDetails across all filtered classes
      const courseMap = {};
      filteredClasses.forEach(c => {
        if (c.courseDetails && Array.isArray(c.courseDetails)) {
          c.courseDetails.forEach(cd => {
            if (cd.courseCode && cd.courseName) {
              courseMap[cd.courseCode] = cd.courseName;
            }
          });
        }
      });

      const subjectsWithNames = distinctSubjectCodes.map(code => ({
        code: code,
        name: courseMap[code] || "Unknown Subject Name"
      }));

      setSubjects(subjectsWithNames);
      
      if (subjectsWithNames.length > 0) {
        setFormData(prev => ({ ...prev, selectedSubject: subjectsWithNames[0].code, isCustomSubject: false, customSubject: "" }));
      } else {
        setFormData(prev => ({ ...prev, selectedSubject: "CUSTOM", isCustomSubject: true, customSubject: "" }));
      }
    } catch(e) { console.error(e); }
  };
  
  useEffect(() => {
    fetchSubjectsForSelection();
  }, [formData.department, formData.year, formData.semester, formData.section]);
  
  // Trigger update when form data changes (and is ready)
  useEffect(() => {
    if (template && (formData.selectedSubject !== "CUSTOM" || formData.customSubject.length > 2)) {
      const delayDebounceFn = setTimeout(() => {
        processSubjectData(formData, template);
      }, 500); // 500ms debounce for custom subject typing
      return () => clearTimeout(delayDebounceFn);
    }
  }, [formData.selectedSubject, formData.customSubject, formData.isCustomSubject, formData.department, formData.year, formData.semester, formData.section, formData.regulation, formData.academicYear, template, rosters]);

  const handlePrint = () => {
    window.print();
  };

  const getDisplaySubjectName = () => {
    if (formData.isCustomSubject) return formData.customSubject;
    const foundSubject = subjects.find(s => s.code === formData.selectedSubject);
    return foundSubject ? `${foundSubject.code} - ${foundSubject.name}` : formData.selectedSubject;
  };

  return (
    <div className="fade-in" style={{ padding: "1rem" }}>
      <div className="no-print">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
          <div>
            <h1 style={{ fontSize: "1.8rem", fontWeight: "800", color: "var(--primary)", margin: 0, display: "flex", alignItems: "center", gap: "10px" }}>
              <FileSpreadsheet size={28} /> Internal Mark Generator
            </h1>
            <p style={{ color: "var(--text-muted)", marginTop: "0.5rem" }}>Generate and print dynamic internal mark sheets automatically.</p>
          </div>
          
          <button 
            onClick={handlePrint} 
            className="btn btn-primary" 
            disabled={!template || studentsData.length === 0}
            style={{ padding: "0.75rem 1.5rem", borderRadius: "12px", boxShadow: "0 4px 15px rgba(99, 102, 241, 0.3)", display: "flex", alignItems: "center", gap: "8px", fontWeight: "bold" }}
          >
            <Printer size={20} /> Print Report
          </button>
        </div>
        
        {!template ? (
          <div style={{ background: "rgba(239,68,68,0.1)", padding: "1.5rem", borderRadius: "12px", border: "1px solid rgba(239,68,68,0.2)", color: "var(--danger)", display: "flex", alignItems: "center", gap: "1rem", marginBottom: "2rem" }}>
            <AlertTriangle size={28} />
            <div>
              <h3 style={{ margin: "0 0 0.25rem 0", fontWeight: "bold" }}>Configuration Required</h3>
              <p style={{ margin: 0, fontSize: "0.9rem" }}>No active template found for Regulation {formData.regulation}. Please ask the Administrator to configure an active Internal Mark Template in the Admin Panel.</p>
            </div>
          </div>
        ) : (
          <div style={{ background: "rgba(34, 197, 94, 0.1)", padding: "1rem 1.5rem", borderRadius: "12px", border: "1px solid rgba(34, 197, 94, 0.2)", color: "#16a34a", display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "2rem" }}>
            <CheckCircle2 size={24} />
            <span style={{ fontWeight: "600" }}>Active Template Applied: {template.templateName}</span>
          </div>
        )}

        <div className="glass-card" style={{ padding: "1.5rem", borderRadius: "16px", marginBottom: "2rem" }}>
          <h3 style={{ marginBottom: "1.5rem", color: "var(--text-color)", borderBottom: "1px solid var(--border-color)", paddingBottom: "0.5rem" }}>Select Class Parameters</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "1.5rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", marginBottom: "0.5rem", color: "var(--text-muted)" }}>Regulation</label>
              <select className="input-field" value={formData.regulation} onChange={e => setFormData({...formData, regulation: e.target.value})}>
                {["2019", "2021", "2025"].map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", marginBottom: "0.5rem", color: "var(--text-muted)" }}>Academic Year</label>
              <input type="text" className="input-field" value={formData.academicYear} onChange={e => setFormData({...formData, academicYear: e.target.value})} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", marginBottom: "0.5rem", color: "var(--text-muted)" }}>Department</label>
              <select className="input-field" value={formData.department} onChange={e => setFormData({...formData, department: e.target.value})}>
                {["CSE", "AI&DS", "ECE", "EEE", "MECH", "CIVIL", "IT"].map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", marginBottom: "0.5rem", color: "var(--text-muted)" }}>Year</label>
              <select className="input-field" value={formData.year} onChange={e => setFormData({...formData, year: e.target.value})}>
                {["I", "II", "III", "IV"].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", marginBottom: "0.5rem", color: "var(--text-muted)" }}>Semester</label>
              <select className="input-field" value={formData.semester} onChange={e => setFormData({...formData, semester: e.target.value})}>
                {["I", "II", "III", "IV", "V", "VI", "VII", "VIII"].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", marginBottom: "0.5rem", color: "var(--text-muted)" }}>Section</label>
              <select className="input-field" value={formData.section} onChange={e => setFormData({...formData, section: e.target.value})}>
                {["A", "B", "C", "D"].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          
          <div style={{ marginTop: "1.5rem", paddingTop: "1.5rem", borderTop: "1px dashed var(--border-color)", display: "flex", gap: "1rem", alignItems: "flex-end" }}>
            <div style={{ flex: 1, maxWidth: "300px" }}>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", marginBottom: "0.5rem", color: "var(--primary)" }}>Target Subject</label>
              <select 
                className="input-field" 
                value={formData.selectedSubject || ""} 
                onChange={handleSubjectDropdownChange}
                style={{ border: "1px solid var(--primary)", background: "rgba(99, 102, 241, 0.05)" }}
              >
                {subjects.map(s => <option key={s.code} value={s.code}>{s.code} - {s.name}</option>)}
                <option value="CUSTOM">+ Type Custom Subject</option>
              </select>
            </div>
            
            {formData.isCustomSubject && (
              <div style={{ flex: 1, maxWidth: "300px", animation: "fadeIn 0.3s ease-out" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "0.85rem", fontWeight: "bold", marginBottom: "0.5rem", color: "var(--primary)" }}>
                  <Type size={14} /> Enter Subject Code
                </label>
                <input 
                  type="text" 
                  className="input-field" 
                  placeholder="E.g. 25CSS31"
                  value={formData.customSubject}
                  onChange={handleCustomSubjectChange}
                  style={{ border: "1px solid var(--primary)", background: "rgba(99, 102, 241, 0.05)" }}
                  autoFocus
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {loading && (
        <div className="no-print" style={{ textAlign: "center", padding: "3rem", color: "var(--text-muted)" }}>
          <div style={{ width: "40px", height: "40px", border: "4px solid rgba(99,102,241,0.2)", borderTop: "4px solid var(--primary)", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 1rem auto" }}></div>
          Calculating internal marks...
        </div>
      )}

      {/* ON-SCREEN PREVIEW & PRINTABLE AREA */}
      {template && studentsData.length > 0 && !loading && (
        <div className="printable-internal-mark fade-in">
          <style>{`
            .printable-internal-mark { 
              background: #fff; 
              color: #000; 
              padding: 2rem; 
              border-radius: 8px; 
              box-shadow: 0 4px 20px rgba(0,0,0,0.1); 
              overflow-x: auto;
            }
            .internal-mark-table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px; color: #000; }
            .internal-mark-table th, .internal-mark-table td { border: 1px solid #333; padding: 8px 6px; text-align: center; }
            .internal-mark-table th { font-weight: bold; background: #f0f4f8; }
            .text-left { text-align: left !important; }
            
            @media print {
              @page { size: landscape; margin: 10mm; }
              body { background: #fff; }
              body * { visibility: hidden; }
              .printable-internal-mark, .printable-internal-mark * { visibility: visible; }
              .printable-internal-mark { position: absolute; left: 0; top: 0; width: 100%; padding: 0; box-shadow: none; }
              .no-print { display: none !important; }
              .internal-mark-table { font-size: 11px; }
              .internal-mark-table th { background: transparent !important; }
            }
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
            <div>Regulation : {formData.regulation}</div>
            <div>Year / Sem / Sec : {formData.year}/{formData.semester}/{formData.section}</div>
          </div>

          <table className="internal-mark-table">
            <thead>
              <tr>
                <th rowSpan="2" style={{ width: "40px" }}>S.No</th>
                <th rowSpan="2" style={{ width: "100px" }}>Register No.</th>
                <th className="text-left" style={{ minWidth: "200px" }}>Name of the Subject: <span style={{ fontWeight: "normal" }}>{getDisplaySubjectName()}</span></th>
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
                  <td className="text-left" style={{ fontWeight: "600" }}>{student.name}</td>
                  {template.columns.map((col, colIdx) => {
                    const val = student[col.heading];
                    return (
                      <td key={colIdx} style={{ fontWeight: col.type === "calculation" || col.type === "formula" ? "bold" : "normal" }}>
                        {val !== undefined ? val : "-"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          
          <div style={{ marginTop: "40px", display: "flex", justifyContent: "space-between", color: "#000", fontWeight: "bold", fontSize: "14px" }}>
            <div>Prepared By</div>
            <div>Class Advisor</div>
            <div>HoD</div>
            <div>COE</div>
          </div>
        </div>
      )}
      
      {!loading && getDisplaySubjectName() && studentsData.length === 0 && template && (
        <div className="no-print" style={{ textAlign: "center", padding: "3rem", background: "var(--bg-secondary)", borderRadius: "12px", border: "1px dashed var(--border-color)" }}>
          <p style={{ color: "var(--text-muted)", fontSize: "1.1rem" }}>No students found in the Roster for this class.</p>
          <p style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>Please ask the admin to upload the Student Roster for {formData.year}/{formData.semester}/{formData.section} so we can generate empty marksheets.</p>
        </div>
      )}
    </div>
  );
}
