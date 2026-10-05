import React, { useState, useEffect } from "react";
import API from "../api";
import { Printer, Save, Trash2, Plus, LayoutGrid, RotateCcw, Download, Users, X } from "lucide-react";
import * as XLSX from 'xlsx';
import ManualSeatEditor from "./ManualSeatEditor";

export default function SeatingManager() {
  const [activeTab, setActiveTab] = useState("generator"); 
  
  // Master Halls State
  const [halls, setHalls] = useState([]);
  const [editingHallId, setEditingHallId] = useState(null);
  const [hallForm, setHallForm] = useState({ hallNumber: '', totalCapacity: '40', columns: '8', layoutType: 'Standard' });

  // Master Rosters 
  const [rosters, setRosters] = useState([]);
  
  // Generator State
  const [examDate, setExamDate] = useState(() => localStorage.getItem("seatingExamDate") || new Date().toLocaleDateString('en-GB').replace(/\//g, '.'));
  const [examName, setExamName] = useState(() => localStorage.getItem("seatingExamName") || "CIA I");
  const [academicYear, setAcademicYear] = useState(() => localStorage.getItem("seatingAcademicYear") || "2025-26(ODD SEMESTER)");
  const [subHeaderText, setSubHeaderText] = useState(() => localStorage.getItem("seatingSubHeaderText") || "OFFICE OF THE CONTROLLER OF THE EXAMINATION");
  const [branchName, setBranchName] = useState(() => localStorage.getItem("seatingBranchName") || "CSE");
  const [iqacNumber, setIqacNumber] = useState(() => localStorage.getItem("seatingIqacNumber") || "");
  const [noteText, setNoteText] = useState(() => localStorage.getItem("seatingNoteText") || "SESSION : FN | TIME : 10.00 am to 01.00 pm");
  const [showEcSignature, setShowEcSignature] = useState(() => {
    const val = localStorage.getItem("seatingShowEcSignature");
    return val !== null ? val === "true" : true;
  });
  const [showHodSignature, setShowHodSignature] = useState(() => {
    const val = localStorage.getItem("seatingShowHodSignature");
    return val !== null ? val === "true" : true;
  });
  const [selectedRosters, setSelectedRosters] = useState([]);
  const [selectedHalls, setSelectedHalls] = useState([]);
  const [shuffleClasses, setShuffleClasses] = useState(false);
  const [libraryFillPreference, setLibraryFillPreference] = useState("Computer First");
  const [excludedStudents, setExcludedStudents] = useState([]);
  const [showStudentManager, setShowStudentManager] = useState(false);
  const [generatedPlan, setGeneratedPlan] = useState(null);

  // Saved Plans State
  const [savedPlans, setSavedPlans] = useState([]);
  const [editingPlan, setEditingPlan] = useState(null);
  const [headerImage, setHeaderImage] = useState(() => localStorage.getItem("seatingHeaderImage") || null);

  // Fetch initial data
  useEffect(() => {
    fetchHalls();
    fetchRosters();
  }, []);

  // Persist form fields to localStorage
  useEffect(() => {
    localStorage.setItem("seatingExamDate", examDate);
    localStorage.setItem("seatingExamName", examName);
    localStorage.setItem("seatingAcademicYear", academicYear);
    localStorage.setItem("seatingSubHeaderText", subHeaderText);
    localStorage.setItem("seatingBranchName", branchName);
    localStorage.setItem("seatingIqacNumber", iqacNumber);
    localStorage.setItem("seatingNoteText", noteText);
    localStorage.setItem("seatingShowEcSignature", showEcSignature);
    localStorage.setItem("seatingShowHodSignature", showHodSignature);
  }, [examDate, examName, academicYear, subHeaderText, branchName, iqacNumber, noteText, showEcSignature, showHodSignature]);

  const fetchHalls = async () => {
    try {
      const res = await API.get("/api/seating/halls");
      setHalls(res.data);
    } catch (err) { console.error(err); }
  };

  const fetchRosters = async () => {
    try {
      const res = await API.get("/api/rosters");
      setRosters(res.data);
    } catch (err) { console.error(err); }
  };

  const fetchPlans = async () => {
    try {
      const res = await API.get("/api/seating/plans");
      setSavedPlans(res.data);
    } catch (err) { console.error(err); }
  };

  useEffect(() => {
    if (activeTab === "plans") fetchPlans();
  }, [activeTab]);

  const handleSaveHall = async () => {
    if (!hallForm.hallNumber) return;
    try {
      if (editingHallId) {
        await API.put(`/api/seating/halls/${editingHallId}`, hallForm);
        setEditingHallId(null);
      } else {
        await API.post("/api/seating/halls", hallForm);
      }
      setHallForm({ hallNumber: "", totalCapacity: "40", columns: "8", layoutType: "Standard" });
      fetchHalls();
    } catch (err) {
      alert("Error saving hall: " + (err.response?.data?.error || err.message));
    }
  };

  const handleEditHall = (hall) => {
    setEditingHallId(hall._id);
    setHallForm({
      hallNumber: hall.hallNumber,
      totalCapacity: hall.totalCapacity || '40',
      columns: hall.columns || '8',
      layoutType: hall.layoutType || 'Standard'
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteHall = async (id) => {
    if (!window.confirm("Delete this hall?")) return;
    try {
      await API.delete(`/api/seating/halls/${id}`);
      fetchHalls();
    } catch (err) { console.error(err); }
  };

  const handleGenerate = async () => {
    if (selectedRosters.length === 0) {
      alert("Please select at least one cohort.");
      return;
    }
    if (selectedHalls.length === 0) {
      alert("Please select at least one hall.");
      return;
    }
    try {
      const res = await API.post("/api/seating/generate", {
        date: examDate,
        examName,
        academicYear,
        branchName,
        subHeaderText,
        iqacNumber,
        noteText,
        showEcSignature,
        showHodSignature,
        rosterIds: selectedRosters,
        hallIds: selectedHalls,
        shuffleClasses,
        libraryFillPreference,
        excludedStudents
      });
      setGeneratedPlan(res.data);
    } catch (err) {
      alert("Error generating plan: " + (err.response?.data?.error || err.message));
    }
  };

  const handleSavePlan = async () => {
    if (!generatedPlan) return;
    try {
      await API.post("/api/seating/plans", generatedPlan);
      alert("Plan saved successfully!");
      setActiveTab("plans");
    } catch (err) {
      alert("Error saving plan: " + err.message);
    }
  };

  const handleDeletePlan = async (id) => {
    if (!window.confirm("Delete this plan?")) return;
    try {
      await API.delete(`/api/seating/plans/${id}`);
      fetchPlans();
    } catch (err) { console.error(err); }
  };

  const getSelectedRostersInfo = () => {
    const selected = rosters.filter(r => selectedRosters.includes(r._id));
    const uniqueYears = [...new Set(selected.map(r => r.year))];
    const totalStudents = selected.reduce((sum, r) => sum + r.students.length, 0);
    return { selected, uniqueYears, totalStudents };
  };

  const getSelectedHallsInfo = () => {
    const selectedHallsData = halls.filter(h => selectedHalls.includes(h._id));
    const totalCapacity = selectedHallsData.reduce((sum, h) => {
      if (h.layoutType === 'Library') return sum + 84;
      if (h.layoutType === 'Library 2') return sum + 108;
      return sum + (h.totalCapacity || 0);
    }, 0);
    return { selectedHallsData, totalCapacity };
  };

  const { selected, uniqueYears, totalStudents } = getSelectedRostersInfo();
  const { totalCapacity } = getSelectedHallsInfo();
  const showShuffleToggle = uniqueYears.length === 1 && selectedRosters.length > 1;
  const showLibraryPreference = halls.some(h => selectedHalls.includes(h._id) && (h.layoutType === 'Library' || h.layoutType === 'Library 2'));

  const handleLogoUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
         setHeaderImage(reader.result);
         try { localStorage.setItem("seatingHeaderImage", reader.result); } catch(err) { console.error("Could not save to localStorage", err); }
      };
      reader.readAsDataURL(file);
    }
  };

  // Custom styling for tables in print layout to match screenshot
  const tableStyles = { borderCollapse: 'collapse', width: '100%', textAlign: 'center', fontSize: '12px', fontWeight: 'bold', fontFamily: 'Times New Roman, serif' };
  const thStyles = { border: '1px solid black', padding: '4px', backgroundColor: '#f0f0f0', fontWeight: 'bold' };
  const tdStyles = { padding: '2px', height: '24px', fontWeight: 'bold' };

  const handleExportExcel = () => {
    if (!generatedPlan) return;
    
    const wb = XLSX.utils.book_new();

    generatedPlan.allocations.forEach(alloc => {
      let sheetData = [];
      sheetData.push([`HALL NO: ${alloc.hallNumber}`, "", "", `Date: ${generatedPlan.examDate}`]);
      if (generatedPlan.noteText) {
        sheetData.push(["", "", "", `Note: ${generatedPlan.noteText}`]);
      }
      sheetData.push(["", "", "", `Branch: ${generatedPlan.branchName || 'Multiple'}`]);
      sheetData.push([]);
      
      if (alloc.layoutType === 'Standard') {
         let headers = alloc.columnsData.map((_, i) => `${['I','II','III','IV','V','VI','VII','VIII','IX','X'][i] || (i+1)} ROW`);
         sheetData.push(headers);
         
         const maxRows = Math.max(...alloc.columnsData.map(c => c.length), 0);
         for (let r = 0; r < maxRows; r++) {
           let row = [];
           for (let c = 0; c < alloc.columnsData.length; c++) {
             row.push(alloc.columnsData[c][r] || "");
           }
           sheetData.push(row);
         }
      } else {
         sheetData.push(["COMPUTER TABLES"]);
         alloc.libraryData.computerTables.forEach((table, tIdx) => {
            sheetData.push([`TABLE ${tIdx + 1}`]);
            sheetData.push(table.map(col => col[0])); 
            sheetData.push(table.map(col => col[1])); 
            sheetData.push([]);
         });
         sheetData.push(["READING TABLES"]);
         alloc.libraryData.readingTables.forEach((table, tIdx) => {
            sheetData.push([`TABLE ${tIdx + 1}`]);
            sheetData.push(table.map(col => col[0])); 
            sheetData.push(table.map(col => col[1])); 
            sheetData.push([]);
         });
      }
      
      sheetData.push([]);
      sheetData.push(["Summary"]);
      sheetData.push(["BRANCH/YEAR/SEM", "Alloted Range", "Count"]);
      alloc.summaryRanges?.forEach(r => {
        sheetData.push([r.branch.toUpperCase(), r.range, r.count]);
      });
      sheetData.push(["Total No of Students", "", alloc.totalAllocated]);
      
      const ws = XLSX.utils.aoa_to_sheet(sheetData);
      XLSX.utils.book_append_sheet(wb, ws, `Hall ${alloc.hallNumber}`);
    });
    
    let consData = [];
    consData.push(["SEATING ARRANGEMENT - CONSOLIDATION"]);
    consData.push([generatedPlan.examName]);
    consData.push([]);
    consData.push(["Sl.No", "Hall Number", "Branch/Year/Sem/Sec", "Reg. No.", "Class Strength", "Total Strength"]);
    
    let slNo = 1;
    generatedPlan.allocations.forEach(alloc => {
       if (alloc.summaryRanges && alloc.summaryRanges.length > 0) {
         alloc.summaryRanges.forEach((range, rIdx) => {
           if (rIdx === 0) {
             consData.push([slNo++, alloc.hallNumber, range.branch.toUpperCase(), range.range, range.count, alloc.totalAllocated]);
           } else {
             consData.push(["", "", range.branch.toUpperCase(), range.range, range.count, ""]);
           }
         });
       } else {
         consData.push([slNo++, alloc.hallNumber, "No Data", "", "", alloc.totalAllocated]);
       }
    });
    
    const grandTotal = generatedPlan.allocations.reduce((sum, a) => sum + a.totalAllocated, 0);
    consData.push(["", "", "", "TOTAL", grandTotal, grandTotal]);
    
    const consWs = XLSX.utils.aoa_to_sheet(consData);
    XLSX.utils.book_append_sheet(wb, consWs, "Consolidation");

    XLSX.writeFile(wb, `${generatedPlan.examName}_Seating_Plan.xlsx`);
  };

  return (
    <div className="fade-in">
      
      {/* Header controls (Hidden in Print) */}
      <div className="glass-card mb-6 header-flex no-print" style={{ padding: "1.5rem" }}>
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: 0, color: 'var(--primary)' }}>
            <LayoutGrid size={24} /> Exam Seating Arranger
          </h2>
          <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
             <button className={`btn ${activeTab === 'generator' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('generator')}>Seating Generator</button>
             <button className={`btn ${activeTab === 'halls' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('halls')}>Master Halls</button>
             <button className={`btn ${activeTab === 'plans' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('plans')}>Saved Plans</button>
          </div>
        </div>
        
        {activeTab === 'generator' && (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
             <button className="btn btn-secondary" onClick={() => setGeneratedPlan(null)}>
               <RotateCcw size={16} /> Reset
             </button>
             <button className="btn btn-primary" onClick={handleGenerate}>
               Generate Plan
             </button>
             {generatedPlan && (
               <>
                 <button className="btn btn-primary" style={{ background: 'var(--success)' }} onClick={handleSavePlan}>
                   <Save size={16} /> Save Plan
                 </button>
                 <button className="btn btn-primary" style={{ background: '#107c41' }} onClick={handleExportExcel}>
                   <Download size={16} /> Export Excel
                 </button>
                 <button className="btn btn-primary" style={{ background: 'var(--accent)' }} onClick={() => window.print()}>
                   <Printer size={16} /> Print All
                 </button>
               </>
             )}
          </div>
        )}
      </div>

      {/* TABS CONTENT */}
      <div>
        
        {/* === MASTER HALLS === */}
        {activeTab === 'halls' && (
          <div className="admin-grid no-print">
            {/* Add Hall Card */}
            <div className="glass-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h3 style={{ margin: 0 }}>{editingHallId ? 'Edit Hall' : 'Add New Hall'}</h3>
                {editingHallId && (
                  <button className="btn-secondary" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => {
                    setEditingHallId(null);
                    setHallForm({ hallNumber: '', totalCapacity: '40', columns: '8', layoutType: 'Standard' });
                  }}>Cancel</button>
                )}
              </div>
              <div className="form-group">
                <label className="input-label">Hall Name / Number</label>
                <input type="text" className="text-input" value={hallForm.hallNumber} onChange={e => setHallForm({...hallForm, hallNumber: e.target.value})} />
              </div>
              
              <div className="form-group" style={{ marginTop: '1rem' }}>
                <label className="input-label">Layout Type</label>
                <select className="select-input" value={hallForm.layoutType} onChange={e => setHallForm({...hallForm, layoutType: e.target.value})}>
                  <option value="Standard">Standard (Columns)</option>
                  <option value="Library">Library Model 1 (24 Reading Seats)</option>
                  <option value="Library 2">Library Model 2 (48 Reading Seats)</option>
                </select>
              </div>

              {hallForm.layoutType === 'Standard' && (
                <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="input-label">Total Capacity</label>
                    <input type="number" className="text-input" value={hallForm.totalCapacity} onChange={e => setHallForm({...hallForm, totalCapacity: e.target.value})} />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="input-label">Columns</label>
                    <input type="number" className="text-input" value={hallForm.columns} onChange={e => setHallForm({...hallForm, columns: e.target.value})} />
                  </div>
                </div>
              )}
              {hallForm.layoutType === 'Library' && (
                <div style={{ marginTop: '1rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                   * Library Model 1 has a fixed capacity of 84 seats (60 Computer, 24 Reading).
                </div>
              )}
              {hallForm.layoutType === 'Library 2' && (
                <div style={{ marginTop: '1rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                   * Library Model 2 has a fixed capacity of 108 seats (60 Computer, 48 Reading).
                </div>
              )}
              
              <button className="btn btn-primary" style={{ width: '100%', marginTop: '1.5rem' }} onClick={handleSaveHall}>
                <Plus size={18} /> {editingHallId ? 'Update Hall' : 'Add Hall'}
              </button>
            </div>

            {/* Existing Halls */}
            {halls.map(hall => (
              <div key={hall._id} className="glass-card" style={{ position: 'relative' }}>
                <div style={{ position: 'absolute', top: '15px', right: '15px', display: 'flex', gap: '8px' }}>
                  <button onClick={() => handleEditHall(hall)} className="btn-icon" style={{ color: 'var(--primary)' }} title="Edit Hall">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                  </button>
                  <button onClick={() => handleDeleteHall(hall._id)} className="btn-icon" style={{ color: 'var(--danger)' }} title="Delete Hall">
                    <Trash2 size={16} />
                  </button>
                </div>
                <h3 style={{ marginBottom: '1rem' }}>Hall Data</h3>
                <div className="form-group" style={{ pointerEvents: 'none', marginBottom: '1rem' }}>
                  <label className="input-label">Hall Name</label>
                  <input type="text" className="text-input" value={hall.hallNumber} readOnly />
                </div>
                <div style={{ display: 'flex', gap: '1rem', pointerEvents: 'none' }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="input-label">Layout</label>
                    <input type="text" className="text-input" value={hall.layoutType} readOnly />
                  </div>
                  {hall.layoutType === 'Standard' && (
                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="input-label">Capacity</label>
                      <input type="text" className="text-input" value={`${hall.totalCapacity} (${hall.columns} Col)`} readOnly />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}


        {/* === GENERATOR === */}
        {activeTab === 'generator' && (
          <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
            
            {/* Sidebar configurations */}
            <div className="no-print" style={{ width: '100%', maxWidth: '350px', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div className="glass-card">
                 <div className="form-group" style={{ marginBottom: '1rem' }}>
                    <label className="input-label">Date</label>
                    <input type="text" className="text-input" value={examDate} onChange={e => setExamDate(e.target.value)} />
                 </div>
                 <div className="form-group" style={{ marginBottom: '1rem' }}>
                    <label className="input-label">Exam Name</label>
                    <input type="text" className="text-input" value={examName} onChange={e => setExamName(e.target.value)} />
                 </div>
                 <div className="form-group" style={{ marginBottom: '1rem' }}>
                    <label className="input-label">Academic Year</label>
                    <input type="text" className="text-input" value={academicYear} onChange={e => setAcademicYear(e.target.value)} />
                 </div>
                 <div className="form-group" style={{ marginBottom: '1rem' }}>
                    <label className="input-label">Sub-Header Text</label>
                    <input type="text" className="text-input" value={subHeaderText} onChange={e => setSubHeaderText(e.target.value)} />
                 </div>
                 <div className="form-group" style={{ marginBottom: '1rem' }}>
                    <label className="input-label">Branch Name</label>
                    <input list="branch-options" type="text" className="text-input" value={branchName} onChange={e => setBranchName(e.target.value)} />
                    <datalist id="branch-options">
                      <option value="CSE" />
                      <option value="AIDS" />
                      <option value="AIML" />
                      <option value="ECE" />
                      <option value="EEE" />
                      <option value="MECH" />
                      <option value="CIVIL" />
                      <option value="IT" />
                      <option value="CSBS" />
                      <option value="BME" />
                      <option value="MCT" />
                      <option value="CYS" />
                    </datalist>
                 </div>
                 <div className="form-group" style={{ marginBottom: '1rem' }}>
                    <label className="input-label">Header Image (Optional)</label>
                    <input type="file" accept="image/*" onChange={handleLogoUpload} style={{ marginBottom: "5px", fontSize: "0.8rem" }} />
                    {headerImage && (
                       <div style={{ marginTop: '5px' }}>
                         <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px" }}>Current Header Preview:</p>
                         <img src={headerImage} alt="Header Preview" style={{ width: "100%", maxHeight: "60px", objectFit: "contain", border: "1px solid var(--border-color)", padding: "2px", background: "white" }} />
                         <button className="btn btn-danger" style={{ padding: '2px 8px', fontSize: '0.7rem', marginTop: '5px' }} onClick={() => { setHeaderImage(null); localStorage.removeItem("seatingHeaderImage"); }}>Remove</button>
                       </div>
                    )}
                 </div>
                 <div className="form-group" style={{ marginBottom: '1rem' }}>
                    <label className="input-label">IQAC Number (Optional)</label>
                    <input type="text" className="text-input" value={iqacNumber} onChange={e => setIqacNumber(e.target.value)} />
                 </div>
                 <div className="form-group" style={{ marginBottom: '1rem' }}>
                    <label className="input-label">Note Text</label>
                    <input type="text" className="text-input" value={noteText} onChange={e => setNoteText(e.target.value)} />
                 </div>
                 <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                   <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem' }}>
                     <input type="checkbox" checked={showEcSignature} onChange={e => setShowEcSignature(e.target.checked)} />
                     Print EC Signature
                   </label>
                   <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem' }}>
                     <input type="checkbox" checked={showHodSignature} onChange={e => setShowHodSignature(e.target.checked)} />
                     Print HOD Signature
                   </label>
                 </div>
              </div>

              <div className="glass-card">
                 <h3 style={{ marginBottom: '1rem' }}>Student Batches</h3>
                 
                 <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                   <label className="input-label" style={{ color: 'var(--primary)', display: 'flex', justifyContent: 'space-between' }}>
                     <span>Select Master Roasters</span>
                   </label>
                   <div style={{ maxHeight: '150px', overflowY: 'auto', background: 'var(--bg-main)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '10px' }}>
                     <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', cursor: 'pointer', fontSize: '0.9rem', padding: '4px 8px', borderRadius: '4px', backgroundColor: 'var(--bg-secondary)', fontWeight: 'bold' }}>
                       <input 
                         type="checkbox" 
                         checked={rosters.length > 0 && selectedRosters.length === rosters.length}
                         onChange={(e) => {
                           if (e.target.checked) setSelectedRosters(rosters.map(r => r._id));
                           else setSelectedRosters([]);
                         }}
                       />
                       <span style={{ flex: 1 }}>Select All</span>
                     </label>
                     {rosters.map(r => (
                       <label key={r._id} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', cursor: 'pointer', fontSize: '0.9rem', padding: '4px 8px', borderRadius: '4px', backgroundColor: selectedRosters.includes(r._id) ? 'var(--bg-secondary)' : 'transparent' }}>
                         <input 
                           type="checkbox" 
                           checked={selectedRosters.includes(r._id)}
                           onChange={(e) => {
                             if (e.target.checked) setSelectedRosters([...selectedRosters, r._id]);
                             else setSelectedRosters(selectedRosters.filter(id => id !== r._id));
                           }}
                         />
                         <span style={{ flex: 1 }}>{r.cohortName}</span>
                         {selectedRosters.includes(r._id) && (
                           <span style={{ fontSize: '0.75rem', backgroundColor: 'var(--primary)', color: 'white', padding: '2px 6px', borderRadius: '12px' }}>
                             {selectedRosters.indexOf(r._id) + 1}
                           </span>
                         )}
                       </label>
                     ))}
                   </div>
                   {selectedRosters.length > 0 && (
                     <button 
                        className="btn btn-secondary" 
                        style={{ width: '100%', marginTop: '10px', display: 'flex', justifyContent: 'center', gap: '8px' }}
                        onClick={() => setShowStudentManager(true)}
                     >
                        <Users size={16} /> Manage Students ({selectedRosters.length} Classes)
                     </button>
                   )}
                 </div>

                 <div className="form-group">
                   <label className="input-label" style={{ color: 'var(--primary)', display: 'flex', justifyContent: 'space-between' }}>
                     <span>Select Exam Halls</span>
                   </label>
                   <div style={{ maxHeight: '150px', overflowY: 'auto', background: 'var(--bg-main)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '10px' }}>
                     <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', cursor: 'pointer', fontSize: '0.9rem', padding: '4px 8px', borderRadius: '4px', backgroundColor: 'var(--bg-secondary)', fontWeight: 'bold' }}>
                       <input 
                         type="checkbox" 
                         checked={halls.length > 0 && selectedHalls.length === halls.length}
                         onChange={(e) => {
                           if (e.target.checked) setSelectedHalls(halls.map(h => h._id));
                           else setSelectedHalls([]);
                         }}
                       />
                       <span style={{ flex: 1 }}>Select All</span>
                     </label>
                     {halls.map(h => (
                       <label key={h._id} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', cursor: 'pointer', fontSize: '0.9rem', padding: '4px 8px', borderRadius: '4px', backgroundColor: selectedHalls.includes(h._id) ? 'var(--bg-secondary)' : 'transparent' }}>
                         <input 
                           type="checkbox" 
                           checked={selectedHalls.includes(h._id)}
                           onChange={(e) => {
                             if (e.target.checked) setSelectedHalls([...selectedHalls, h._id]);
                             else setSelectedHalls(selectedHalls.filter(id => id !== h._id));
                           }}
                         />
                         <span style={{ flex: 1 }}>{h.hallNumber} <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>({h.layoutType})</span></span>
                         {selectedHalls.includes(h._id) && (
                           <span style={{ fontSize: '0.75rem', backgroundColor: 'var(--primary)', color: 'white', padding: '2px 6px', borderRadius: '12px' }}>
                             {selectedHalls.indexOf(h._id) + 1}
                           </span>
                         )}
                       </label>
                     ))}
                   </div>
                 </div>

                  {(totalStudents > 0 || totalCapacity > 0) && (
                    <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'var(--bg-main)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                      <h4 style={{ fontSize: '1rem', marginBottom: '12px', color: 'var(--primary)', borderBottom: '2px solid var(--border-color)', paddingBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
                        <span>Selection Summary</span>
                        {totalStudents > 0 && <span style={{ fontSize: '0.8rem', fontWeight: 'normal', color: 'var(--text-muted)' }}>Years: {uniqueYears.join(", ")}</span>}
                      </h4>
                      
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                        {/* Cohorts Breakdown */}
                        <div>
                          <p style={{ fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '8px', color: 'var(--text-muted)' }}>Selected Cohorts ({totalStudents} Students)</p>
                          <ul style={{ listStyleType: 'none', padding: 0, margin: 0, fontSize: '0.85rem', maxHeight: '120px', overflowY: 'auto' }}>
                            {selected.map(r => (
                               <li key={r._id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px dashed var(--border-color)' }}>
                                 <span>{r.cohortName}</span>
                                 <strong style={{ color: 'var(--primary)' }}>{r.students.length}</strong>
                               </li>
                            ))}
                            {selected.length === 0 && <li style={{ color: 'var(--text-muted)' }}>No cohorts selected</li>}
                          </ul>
                        </div>

                        {/* Halls Breakdown */}
                        <div>
                          <p style={{ fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '8px', color: 'var(--text-muted)' }}>Capacity Status ({totalCapacity} Seats)</p>
                          <div style={{ fontSize: '0.85rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                              <span>Required Seats:</span>
                              <strong>{totalStudents}</strong>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                              <span>Available Capacity:</span>
                              <strong>{totalCapacity}</strong>
                            </div>
                            
                            {totalStudents > 0 && totalStudents > totalCapacity && (
                              <div style={{ marginTop: '12px', padding: '8px', backgroundColor: '#ffebee', color: '#c62828', borderRadius: '4px', textAlign: 'center', fontWeight: 'bold', border: '1px solid #ffcdd2' }}>
                                ⚠️ {totalStudents - totalCapacity} more seats needed!
                              </div>
                            )}
                            {totalStudents > 0 && totalStudents <= totalCapacity && (
                              <div style={{ marginTop: '12px', padding: '8px', backgroundColor: '#e8f5e9', color: '#2e7d32', borderRadius: '4px', textAlign: 'center', fontWeight: 'bold', border: '1px solid #c8e6c9' }}>
                                ✅ Sufficient capacity ({totalCapacity - totalStudents} extra seats)
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                 {showShuffleToggle && (
                   <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                     <input type="checkbox" id="shuffle" checked={shuffleClasses} onChange={e => setShuffleClasses(e.target.checked)} style={{ width: '18px', height: '18px' }} />
                     <label htmlFor="shuffle" className="input-label" style={{ margin: 0 }}>Shuffle Classes? (Admin Opt)</label>
                   </div>
                 )}

                 {showLibraryPreference && (
                   <div className="form-group fade-in" style={{ marginTop: '1.5rem' }}>
                      <label className="input-label">Library Fill Preference</label>
                      <select className="select-input" value={libraryFillPreference} onChange={e => setLibraryFillPreference(e.target.value)}>
                        <option value="Computer First">Computer Tables First</option>
                        <option value="Reading First">Reading Tables First</option>
                      </select>
                   </div>
                 )}
              </div>
            </div>

            {/* Preview Section */}
            <div style={{ flex: 1 }}>
               {!generatedPlan && (
                 <div className="glass-card no-print" style={{ height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                   Select cohorts and generate a plan to see preview.
                 </div>
               )}
               
               {generatedPlan && (
                 <div className="print-container">
                   {generatedPlan.allocations.map((alloc, idx) => {
                      
                      return (
                        <div key={idx} className="bg-white text-black" style={{ minHeight: '297mm', width: '210mm', margin: '0 auto', boxSizing: 'border-box', pageBreakAfter: 'always', padding: '20mm', backgroundColor: 'white', position: 'relative' }}>
                          {generatedPlan.iqacNumber && (
                            <div style={{ textAlign: 'right', fontSize: '11px', fontWeight: 'bold', marginBottom: '5px' }}>
                               {generatedPlan.iqacNumber}
                            </div>
                          )}
                          
                          <div style={{ paddingBottom: '10px', marginBottom: '15px' }}>
                            {headerImage ? (
                               <div style={{ textAlign: 'center', marginBottom: '10px' }}>
                                  <img src={headerImage} alt="Header" style={{ width: '100%', maxHeight: '120px', objectFit: 'contain' }} />
                               </div>
                            ) : (
                               <div style={{ display: 'flex', marginBottom: '10px' }}>
                                 <div style={{ width: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <img src="/logo1.png" alt="Logo" style={{ maxWidth: '80px', maxHeight: '80px', objectFit: 'contain' }} onError={(e) => e.target.style.display = 'none'} />
                                 </div>
                                 <div style={{ flex: 1, textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                                    <h2 style={{ fontSize: '14px', fontWeight: 'bold', margin: '0 0 4px 0', fontFamily: 'Times New Roman, serif' }}>MUTHAYAMMAL ENGINEERING COLLEGE , RASIPURAM &ndash; 637408</h2>
                                 </div>
                               </div>
                            )}
                            <div style={{ textAlign: 'center' }}>
                               {generatedPlan.subHeaderText && (
                                 <h3 style={{ fontSize: '14px', fontWeight: 'bold', margin: '0 0 4px 0', fontFamily: 'Times New Roman, serif' }}>{generatedPlan.subHeaderText}</h3>
                               )}
                               <h4 style={{ fontSize: '14px', fontWeight: 'bold', margin: '0 0 4px 0', fontFamily: 'Times New Roman, serif' }}>ACADEMIC YEAR {generatedPlan.academicYear}</h4>
                               <h4 style={{ fontSize: '14px', fontWeight: 'bold', margin: '0 0 4px 0', fontFamily: 'Times New Roman, serif' }}>SEATING ARRANGEMENT</h4>
                               <h4 style={{ fontSize: '14px', fontWeight: 'bold', margin: '0', fontFamily: 'Times New Roman, serif' }}>{generatedPlan.examName}</h4>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '5px', marginBottom: '15px', fontFamily: 'Times New Roman, serif', fontSize: '14px', fontWeight: 'bold' }}>
                               <div>HALL NO : <span>{alloc.hallNumber}</span></div>
                               <div style={{ textAlign: 'right' }}>
                                  <div style={{ marginBottom: '4px' }}>Branch : {generatedPlan.branchName || "Multiple"}</div>
                                  <div>Date : {generatedPlan.examDate}</div>
                               </div>
                             </div>
                          </div>

                          <h3 style={{ textAlign: 'center', fontWeight: 'bold', fontSize: '14px', marginBottom: '15px', fontFamily: 'Times New Roman, serif' }}>REGISTER NO. OF THE CANDIDATES</h3>

                          {/* STANDARD LAYOUT RENDER */}
                          {alloc.layoutType === 'Standard' && (
                            <table style={tableStyles}>
                              <thead>
                                <tr>
                                  {alloc.columnsData.map((_, cIndex) => (
                                    <th key={cIndex} style={thStyles}>
                                      {['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][cIndex] || (cIndex+1)} ROW
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {Array.from({ length: Math.max(...alloc.columnsData.map(c => c.length), 0) }).map((_, rIndex) => (
                                  <tr key={rIndex}>
                                    {alloc.columnsData.map((col, cIndex) => (
                                      <td key={cIndex} style={{
                                        ...tdStyles,
                                        border: col[rIndex] ? '1px solid black' : 'none'
                                      }}>
                                        {col[rIndex] || ""}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}

                          {/* LIBRARY LAYOUT RENDER */}
                          {(alloc.layoutType === 'Library' || alloc.layoutType === 'Library 2') && (
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                               
                               {/* COMPUTER TABLES (Left) */}
                               <div style={{ width: alloc.layoutType === 'Library 2' ? '58%' : '68%' }}>
                                  {alloc.libraryData.computerTables.map((table, tIdx) => (
                                     <div key={tIdx} style={{ display: 'flex', border: '2px solid black', marginBottom: '15px' }}>
                                        <div style={{ width: '85px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '2px solid black', fontWeight: 'bold', fontSize: '10px', textAlign: 'center', padding: '2px' }}>
                                           COMPUTER<br/>TABLE {tIdx + 1}
                                        </div>
                                        <div style={{ flex: 1 }}>
                                           <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontSize: '10px', fontWeight: 'bold' }}>
                                              <tbody>
                                                 {/* Row 1 */}
                                                 <tr>
                                                   {Array.from({length: 6}).map((_, c) => (
                                                      <td key={`r0-c${c}`} style={{ border: '1px solid black', height: '22px', borderTop: 'none', borderRight: c===5?'none':'1px solid black' }}>
                                                        {table[c][0]}
                                                      </td>
                                                   ))}
                                                 </tr>
                                                 {/* Row 2 */}
                                                 <tr>
                                                   {Array.from({length: 6}).map((_, c) => (
                                                      <td key={`r1-c${c}`} style={{ border: '1px solid black', height: '22px', borderBottom: 'none', borderRight: c===5?'none':'1px solid black' }}>
                                                        {table[c][1]}
                                                      </td>
                                                   ))}
                                                 </tr>
                                              </tbody>
                                           </table>
                                        </div>
                                     </div>
                                  ))}
                               </div>

                               {/* READING TABLES (Right) */}
                               <div style={{ width: alloc.layoutType === 'Library 2' ? '38%' : '28%' }}>
                                  {alloc.libraryData.readingTables.map((table, tIdx) => (
                                     <div key={tIdx} style={{ display: 'flex', border: '2px solid black', marginBottom: '15px' }}>
                                        <div style={{ width: '65px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '2px solid black', fontWeight: 'bold', fontSize: '9px', textAlign: 'center', padding: '2px' }}>
                                           READING<br/>TABLE {tIdx + 1}
                                        </div>
                                        <div style={{ flex: 1 }}>
                                           <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontSize: '10px', fontWeight: 'bold' }}>
                                              <tbody>
                                                 {/* Row 1 */}
                                                 <tr>
                                                   {Array.from({length: alloc.layoutType === 'Library 2' ? 4 : 2}).map((_, c) => (
                                                      <td key={`r0-c${c}`} style={{ border: '1px solid black', height: '22px', borderTop: 'none', borderRight: c===(alloc.layoutType === 'Library 2' ? 3 : 1)?'none':'1px solid black' }}>
                                                        {table[c][0]}
                                                      </td>
                                                   ))}
                                                 </tr>
                                                 {/* Row 2 */}
                                                 <tr>
                                                   {Array.from({length: alloc.layoutType === 'Library 2' ? 4 : 2}).map((_, c) => (
                                                      <td key={`r1-c${c}`} style={{ border: '1px solid black', height: '22px', borderBottom: 'none', borderRight: c===(alloc.layoutType === 'Library 2' ? 3 : 1)?'none':'1px solid black' }}>
                                                        {table[c][1]}
                                                      </td>
                                                   ))}
                                                 </tr>
                                              </tbody>
                                           </table>
                                        </div>
                                     </div>
                                  ))}
                               </div>

                            </div>
                          )}

                          <table style={{ ...tableStyles, marginTop: '20px', border: '2px solid black' }}>
                            <thead>
                              <tr>
                                <th style={{ ...thStyles, width: '40%', border: '1px solid black', padding: '6px' }}>BRANCH/YEAR/SEM</th>
                                <th style={{ ...thStyles, width: '60%', border: '1px solid black', padding: '6px' }}>Alloted</th>
                              </tr>
                            </thead>
                            <tbody>
                              {alloc.summaryRanges && alloc.summaryRanges.map((rangeObj, rIdx) => (
                                <tr key={rIdx}>
                                  <td style={{ ...tdStyles, border: '1px solid black', fontWeight: 'bold' }}>{rangeObj.branch.toUpperCase()}</td>
                                  <td style={{ ...tdStyles, border: '1px solid black', fontWeight: 'bold' }}>
                                    {rangeObj.range} &nbsp;&nbsp;&nbsp; {rangeObj.count}
                                  </td>
                                </tr>
                              ))}
                              <tr>
                                <td style={{ ...tdStyles, border: '1px solid black', borderTop: '2px solid black', fontWeight: 'bold' }}>Total No of Students</td>
                                <td style={{ ...tdStyles, border: '1px solid black', borderTop: '2px solid black', fontWeight: 'bold' }}>
                                  {alloc.totalAllocated}
                                </td>
                              </tr>
                            </tbody>
                          </table>

                          {(generatedPlan.noteText) && (
                            <div style={{ marginTop: '15px', fontWeight: 'bold', fontSize: '13px', fontFamily: 'Times New Roman, serif' }}>
                               NOTE : {generatedPlan.noteText}
                            </div>
                          )}

                          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '90px', padding: '0 40px', fontWeight: 'bold', fontSize: '14px', fontFamily: 'Times New Roman, serif' }}>
                             <div>{generatedPlan.showEcSignature !== false ? 'EC' : ''}</div>
                             <div>{generatedPlan.showHodSignature !== false ? 'HOD' : ''}</div>
                          </div>
                          
                        </div>
                      )
                   })}

                   {/* MASTER CONSOLIDATION PAGE */}
                   <div className="bg-white text-black" style={{ minHeight: '297mm', width: '210mm', margin: '0 auto', boxSizing: 'border-box', padding: '20mm', backgroundColor: 'white', position: 'relative' }}>
                      {generatedPlan.iqacNumber && (
                        <div style={{ textAlign: 'right', fontSize: '11px', fontWeight: 'bold', marginBottom: '5px' }}>
                           {generatedPlan.iqacNumber}
                        </div>
                      )}
                      
                      <div style={{ paddingBottom: '10px', marginBottom: '15px' }}>
                        {headerImage ? (
                           <div style={{ textAlign: 'center', marginBottom: '10px' }}>
                              <img src={headerImage} alt="Header" style={{ width: '100%', maxHeight: '120px', objectFit: 'contain' }} />
                           </div>
                        ) : (
                           <div style={{ display: 'flex', marginBottom: '10px' }}>
                             <div style={{ width: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <img src="/logo1.png" alt="Logo" style={{ maxWidth: '80px', maxHeight: '80px', objectFit: 'contain' }} onError={(e) => e.target.style.display = 'none'} />
                             </div>
                             <div style={{ flex: 1, textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                                <h2 style={{ fontSize: '14px', fontWeight: 'bold', margin: '0 0 4px 0', fontFamily: 'Times New Roman, serif' }}>MUTHAYAMMAL ENGINEERING COLLEGE , RASIPURAM &ndash; 637408</h2>
                             </div>
                           </div>
                        )}
                        <div style={{ textAlign: 'center' }}>
                           {generatedPlan.subHeaderText && (
                             <h3 style={{ fontSize: '14px', fontWeight: 'bold', margin: '0 0 4px 0', fontFamily: 'Times New Roman, serif' }}>{generatedPlan.subHeaderText}</h3>
                           )}
                           <h4 style={{ fontSize: '14px', fontWeight: 'bold', margin: '0 0 4px 0', fontFamily: 'Times New Roman, serif' }}>ACADEMIC YEAR {generatedPlan.academicYear}</h4>
                           <h4 style={{ fontSize: '14px', fontWeight: 'bold', margin: '0 0 4px 0', fontFamily: 'Times New Roman, serif' }}>SEATING ARRANGEMENT - CONSOLIDATION</h4>
                           <h4 style={{ fontSize: '14px', fontWeight: 'bold', margin: '0', fontFamily: 'Times New Roman, serif' }}>{generatedPlan.examName}</h4>
                        </div>
                      </div>

                      <table style={{ ...tableStyles, border: '2px solid black', marginTop: '20px' }}>
                        <thead>
                          <tr>
                            <th style={{ ...thStyles, border: '1px solid black', padding: '6px' }}>Sl.No</th>
                            <th style={{ ...thStyles, border: '1px solid black', padding: '6px' }}>Hall Number</th>
                            <th style={{ ...thStyles, border: '1px solid black', padding: '6px' }}>Branch/Year/Sem/Sec</th>
                            <th style={{ ...thStyles, border: '1px solid black', padding: '6px' }}>Reg. No.</th>
                            <th style={{ ...thStyles, border: '1px solid black', padding: '6px' }}>Class Strength</th>
                            <th style={{ ...thStyles, border: '1px solid black', padding: '6px' }}>Total Strength</th>
                          </tr>
                        </thead>
                        <tbody>
                          {generatedPlan.allocations.map((alloc, idx) => {
                             const rowSpan = alloc.summaryRanges && alloc.summaryRanges.length > 0 ? alloc.summaryRanges.length : 1;
                             return (
                               <React.Fragment key={`cons-${idx}`}>
                                 {alloc.summaryRanges && alloc.summaryRanges.map((range, rIdx) => (
                                    <tr key={`cons-${idx}-${rIdx}`}>
                                      {rIdx === 0 && <td style={{ ...tdStyles, border: '1px solid black' }} rowSpan={rowSpan}>{idx + 1}</td>}
                                      {rIdx === 0 && <td style={{ ...tdStyles, border: '1px solid black', fontWeight: 'bold' }} rowSpan={rowSpan}>{alloc.hallNumber}</td>}
                                      <td style={{ ...tdStyles, border: '1px solid black' }}>{range.branch.toUpperCase()}</td>
                                      <td style={{ ...tdStyles, border: '1px solid black' }}>{range.range}</td>
                                      <td style={{ ...tdStyles, border: '1px solid black' }}>{range.count}</td>
                                      {rIdx === 0 && <td style={{ ...tdStyles, border: '1px solid black', fontWeight: 'bold' }} rowSpan={rowSpan}>{alloc.totalAllocated}</td>}
                                    </tr>
                                 ))}
                                 {(!alloc.summaryRanges || alloc.summaryRanges.length === 0) && (
                                    <tr key={`cons-${idx}-empty`}>
                                      <td style={{ ...tdStyles, border: '1px solid black' }}>{idx + 1}</td>
                                      <td style={{ ...tdStyles, border: '1px solid black', fontWeight: 'bold' }}>{alloc.hallNumber}</td>
                                      <td style={{ ...tdStyles, border: '1px solid black' }} colSpan="3">No Data</td>
                                      <td style={{ ...tdStyles, border: '1px solid black', fontWeight: 'bold' }}>{alloc.totalAllocated}</td>
                                    </tr>
                                 )}
                               </React.Fragment>
                             );
                          })}
                        </tbody>
                        <tfoot>
                           <tr>
                             <td colSpan="4" style={{ ...tdStyles, border: '1px solid black', fontWeight: 'bold', textAlign: 'right', paddingRight: '15px' }}>TOTAL</td>
                             <td style={{ ...tdStyles, border: '1px solid black', fontWeight: 'bold' }}>{generatedPlan.allocations.reduce((sum, a) => sum + a.totalAllocated, 0)}</td>
                             <td style={{ ...tdStyles, border: '1px solid black', fontWeight: 'bold' }}>{generatedPlan.allocations.reduce((sum, a) => sum + a.totalAllocated, 0)}</td>
                           </tr>
                        </tfoot>
                      </table>
                      
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '90px', padding: '0 40px', fontWeight: 'bold', fontSize: '14px', fontFamily: 'Times New Roman, serif' }}>
                         <div>{generatedPlan.showEcSignature !== false ? 'EC' : ''}</div>
                         <div>{generatedPlan.showHodSignature !== false ? 'HOD' : ''}</div>
                      </div>
                   </div>

                 </div>
               )}
            </div>
          </div>
        )}

        {/* === SAVED PLANS === */}
        {activeTab === 'plans' && (
          <div className="glass-card no-print">
            {editingPlan ? (
              <ManualSeatEditor 
                 plan={editingPlan}
                 onSave={() => { setEditingPlan(null); fetchPlans(); }}
                 onCancel={() => setEditingPlan(null)}
              />
            ) : (
              <>
                <h3 style={{ marginBottom: '1.5rem' }}>Saved Seating Plans</h3>
             <div className="admin-table-container">
               <table className="admin-table">
                 <thead>
                   <tr>
                     <th>Date</th>
                     <th>Exam Name</th>
                     <th>Halls</th>
                     <th>Actions</th>
                   </tr>
                 </thead>
                 <tbody>
                   {savedPlans.length === 0 && (
                     <tr><td colSpan="4" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No saved plans.</td></tr>
                   )}
                   {savedPlans.map(plan => (
                     <tr key={plan._id}>
                       <td><strong>{plan.examDate}</strong></td>
                       <td>{plan.examName}</td>
                       <td><span className="status-badge success">{plan.allocations.length} Halls Allocated</span></td>
                       <td style={{ display: 'flex', gap: '10px' }}>
                         <button className="btn btn-secondary" onClick={() => { setGeneratedPlan(plan); setActiveTab('generator'); }}>View</button>
                         <button className="btn btn-primary" onClick={() => setEditingPlan(plan)}>Edit Seating</button>
                         <button className="btn btn-danger" onClick={() => handleDeletePlan(plan._id)}>Delete</button>
                       </td>
                     </tr>
                   ))}
                 </tbody>
               </table>
             </div>
             </>
            )}
          </div>
        )}
      </div>

      {/* === STUDENT MANAGER MODAL === */}
      {showStudentManager && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, 
          display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px'
        }}>
          <div className="glass-card" style={{ width: '100%', maxWidth: '800px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-main)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-color)' }}>
              <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Users size={24} /> Manage Students
              </h2>
              <button className="btn-icon" onClick={() => setShowStudentManager(false)}>
                <X size={24} />
              </button>
            </div>
            
            <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
              Uncheck a student to exclude them from the seating arrangement (e.g., absent, internship).
              Currently {excludedStudents.length} students excluded.
            </p>

            <div style={{ overflowY: 'auto', flex: 1, paddingRight: '10px' }}>
              {selectedRosters.map(rosterId => {
                const roster = rosters.find(r => r._id === rosterId);
                if (!roster) return null;
                return (
                  <div key={roster._id} style={{ marginBottom: '1.5rem' }}>
                    <h4 style={{ backgroundColor: 'var(--bg-secondary)', padding: '8px 12px', borderRadius: '4px', marginBottom: '10px' }}>
                      {roster.cohortName} ({roster.students.length} Students)
                    </h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '10px' }}>
                      {roster.students.map(student => {
                        const isExcluded = excludedStudents.includes(student.regNo);
                        return (
                          <label key={student.regNo} style={{
                            display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', cursor: 'pointer',
                            opacity: isExcluded ? 0.5 : 1, textDecoration: isExcluded ? 'line-through' : 'none'
                          }}>
                            <input 
                              type="checkbox" 
                              checked={!isExcluded}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setExcludedStudents(excludedStudents.filter(r => r !== student.regNo));
                                } else {
                                  setExcludedStudents([...excludedStudents, student.regNo]);
                                }
                              }}
                            />
                            {student.regNo}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ paddingTop: '1rem', marginTop: '1rem', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button className="btn btn-secondary" onClick={() => setExcludedStudents([])}>Reset All</button>
              <button className="btn btn-primary" onClick={() => setShowStudentManager(false)}>Done</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
