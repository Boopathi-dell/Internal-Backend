import React, { useState, useEffect } from "react";
import API from "../api";
import { Plus, Trash, Save, Settings, FileText, Calculator, X } from "lucide-react";

export default function InternalMarkTemplateSetup() {
  const [templates, setTemplates] = useState([]);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [availableExams, setAvailableExams] = useState([]);

  useEffect(() => {
    fetchTemplates();
    fetchAvailableExams();
  }, []);

  const fetchTemplates = async () => {
    try {
      const res = await API.get("/api/internal-marks");
      setTemplates(res.data);
      setLoading(false);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  const fetchAvailableExams = async () => {
    try {
      // Just fetch some classes to extract unique exam names
      const res = await API.get("/api/classes");
      const uniqueExams = [...new Set(res.data.map(c => c.examName).filter(Boolean))];
      setAvailableExams(uniqueExams.length > 0 ? uniqueExams : ["UNIT I", "UNIT II", "UNIT III", "UNIT IV", "UNIT V", "CIA I", "CIA II", "CIA III"]);
    } catch (err) {
      console.error(err);
      setAvailableExams(["UNIT I", "UNIT II", "UNIT III", "UNIT IV", "UNIT V", "CIA I", "CIA II", "CIA III"]);
    }
  };

  const handleAddNewTemplate = () => {
    setEditingTemplate({
      templateName: "2025-26 ODD SEMESTER",
      isActive: false,
      columns: [
        { heading: "UNIT I (30)", type: "exam", examName: "UNIT I", formula: "", calcSources: [], calcOutof: 110, calcWeightage: 10 }
      ]
    });
  };

  const handleSaveTemplate = async () => {
    try {
      // Convert calcSources array to a formula before saving so backend logic remains same
      const dataToSave = { ...editingTemplate };
      dataToSave.columns = dataToSave.columns.map(col => {
        if (col.type === "calculation") {
          // generate formula like: (#[UNIT I] + #[UNIT II] + #[CIA I]) / 110 * 10
          const sumPart = col.calcSources.map(s => `#[${s}]`).join(" + ");
          col.formula = `(${sumPart || '0'}) / ${col.calcOutof || 1} * ${col.calcWeightage || 1}`;
          col.type = "formula"; // Backend expects "formula"
        }
        return col;
      });

      if (editingTemplate._id) {
        await API.put(`/api/internal-marks/${editingTemplate._id}`, dataToSave);
      } else {
        await API.post("/api/internal-marks", dataToSave);
      }
      setEditingTemplate(null);
      fetchTemplates();
    } catch (err) {
      console.error(err);
      alert("Failed to save template.");
    }
  };

  const handleDeleteTemplate = async (id) => {
    if (!window.confirm("Are you sure you want to delete this template?")) return;
    try {
      await API.delete(`/api/internal-marks/${id}`);
      fetchTemplates();
    } catch (err) {
      console.error(err);
      alert("Failed to delete template.");
    }
  };

  const handleAddColumn = (type) => {
    setEditingTemplate(prev => ({
      ...prev,
      columns: [...prev.columns, { 
        heading: type === "exam" ? "New Exam" : "New Calculation", 
        type: type === "exam" ? "exam" : "calculation", 
        examName: "", 
        formula: "",
        calcSources: [],
        calcOutof: 110,
        calcWeightage: 10
      }]
    }));
  };

  const handleColumnChange = (index, field, value) => {
    const newColumns = [...editingTemplate.columns];
    newColumns[index][field] = value;
    setEditingTemplate(prev => ({ ...prev, columns: newColumns }));
  };

  const toggleCalcSource = (colIndex, sourceHeading) => {
    const newColumns = [...editingTemplate.columns];
    const sources = newColumns[colIndex].calcSources || [];
    if (sources.includes(sourceHeading)) {
      newColumns[colIndex].calcSources = sources.filter(s => s !== sourceHeading);
    } else {
      newColumns[colIndex].calcSources = [...sources, sourceHeading];
    }
    setEditingTemplate(prev => ({ ...prev, columns: newColumns }));
  };

  const handleRemoveColumn = (index) => {
    const newColumns = [...editingTemplate.columns];
    newColumns.splice(index, 1);
    setEditingTemplate(prev => ({ ...prev, columns: newColumns }));
  };

  const parseExistingFormula = (template) => {
    // If editing, convert "formula" back to calc UI
    const cloned = { ...template };
    cloned.columns = cloned.columns.map(col => {
      if (col.type === "formula") {
        col.type = "calculation";
        // Parse simple formula: (#[A] + #[B]) / outof * weight
        const match = col.formula.match(/\((.*?)\)\s*\/\s*([\d.]+)\s*\*\s*([\d.]+)/);
        if (match) {
          const sources = [...match[1].matchAll(/#\[(.*?)\]/g)].map(m => m[1]);
          col.calcSources = sources;
          col.calcOutof = parseFloat(match[2]);
          col.calcWeightage = parseFloat(match[3]);
        } else {
          col.calcSources = [];
          col.calcOutof = 100;
          col.calcWeightage = 10;
        }
      }
      return col;
    });
    setEditingTemplate(cloned);
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div className="card">
      <h2 style={{ marginBottom: "1rem", color: "var(--primary)" }}>Internal Mark Templates</h2>
      
      {!editingTemplate ? (
        <div>
          <button onClick={handleAddNewTemplate} className="btn btn-primary" style={{ marginBottom: "1.5rem" }}>
            <Plus size={16} /> Create New Template
          </button>
          
          <table className="table">
            <thead>
              <tr>
                <th>Template Name</th>
                <th>Status</th>
                <th>Columns</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map(t => (
                <tr key={t._id}>
                  <td style={{ fontWeight: "bold" }}>{t.templateName}</td>
                  <td>
                    {t.isActive ? 
                      <span style={{ background: "rgba(34, 197, 94, 0.2)", color: "#16a34a", padding: "4px 8px", borderRadius: "4px", fontWeight: "bold", fontSize: "0.8rem" }}>Active</span> 
                      : <span style={{ color: "var(--text-muted)" }}>Inactive</span>}
                  </td>
                  <td>{t.columns.length} columns</td>
                  <td>
                    <button onClick={() => parseExistingFormula(t)} className="btn btn-secondary btn-sm" style={{ marginRight: "0.5rem" }}>Edit Format</button>
                    <button onClick={() => handleDeleteTemplate(t._id)} className="btn btn-danger btn-sm"><Trash size={14} /></button>
                  </td>
                </tr>
              ))}
              {templates.length === 0 && (
                <tr>
                  <td colSpan="4" style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}>No templates created yet. Click above to make one!</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="fade-in">
          <div style={{ background: "var(--bg-secondary)", padding: "1.5rem", borderRadius: "12px", marginBottom: "1.5rem", border: "1px solid var(--border-color)" }}>
            <div style={{ display: "flex", gap: "1.5rem", alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", marginBottom: "0.5rem" }}>Template Name (E.g. ODD SEM 2026)</label>
                <input 
                  type="text" 
                  className="input-field" 
                  value={editingTemplate.templateName}
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, templateName: e.target.value })}
                  style={{ fontSize: "1.1rem", padding: "10px" }}
                />
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: "rgba(99, 102, 241, 0.1)", padding: "10px 15px", borderRadius: "8px", cursor: "pointer", border: "1px solid var(--primary)", color: "var(--primary)", fontWeight: "bold", marginTop: "20px" }}>
                <input 
                  type="checkbox" 
                  checked={editingTemplate.isActive} 
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, isActive: e.target.checked })}
                  style={{ width: "20px", height: "20px" }}
                />
                Use this as Active Format
              </label>
            </div>
          </div>

          <h3 style={{ marginBottom: "1rem" }}>Define Columns (Left to Right)</h3>
          
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {editingTemplate.columns.map((col, index) => (
              <div key={index} style={{ 
                background: "var(--bg-secondary)", 
                border: "1px solid var(--border-color)", 
                borderRadius: "12px", 
                padding: "1.5rem",
                position: "relative"
              }}>
                <button 
                  onClick={() => handleRemoveColumn(index)} 
                  style={{ position: "absolute", top: "10px", right: "10px", background: "none", border: "none", color: "var(--danger)", cursor: "pointer" }}
                  title="Remove Column"
                >
                  <X size={20} />
                </button>

                <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
                  <div style={{ background: "var(--primary)", color: "white", width: "30px", height: "30px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", fontWeight: "bold" }}>
                    {index + 1}
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: "0.85rem", fontWeight: "bold" }}>Column Heading (Visible on Printout)</label>
                    <input 
                      type="text" 
                      className="input-field" 
                      placeholder="E.g. UNIT I (30) or CIA I IM (10)" 
                      value={col.heading} 
                      onChange={(e) => handleColumnChange(index, 'heading', e.target.value)}
                    />
                  </div>
                  <div style={{ width: "200px" }}>
                    <label style={{ fontSize: "0.85rem", fontWeight: "bold" }}>Column Type</label>
                    <div style={{ padding: "8px", background: "rgba(0,0,0,0.1)", borderRadius: "6px", fontWeight: "600", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      {col.type === "exam" ? <FileText size={16} className="text-primary" /> : <Calculator size={16} className="text-success" />}
                      {col.type === "exam" ? "Fetch Exam Marks" : "Auto Calculation"}
                    </div>
                  </div>
                </div>

                {col.type === "exam" && (
                  <div style={{ background: "var(--bg-main)", padding: "1rem", borderRadius: "8px", borderLeft: "4px solid var(--primary)" }}>
                    <label style={{ fontSize: "0.85rem", fontWeight: "bold", display: "block", marginBottom: "0.5rem" }}>Which Exam's marks should be shown here?</label>
                    <select 
                      className="input-field" 
                      value={col.examName} 
                      onChange={(e) => handleColumnChange(index, 'examName', e.target.value)}
                      style={{ maxWidth: "300px" }}
                    >
                      <option value="">-- Select Exam --</option>
                      {availableExams.map(ex => <option key={ex} value={ex}>{ex}</option>)}
                      <option value="SEMINAR">SEMINAR</option>
                      <option value="MKC">MKC</option>
                    </select>
                    <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
                      This maps exactly to the exams created by staff.
                    </p>
                  </div>
                )}

                {col.type === "calculation" && (
                  <div style={{ background: "var(--bg-main)", padding: "1rem", borderRadius: "8px", borderLeft: "4px solid #10b981" }}>
                    <label style={{ fontSize: "0.85rem", fontWeight: "bold", display: "block", marginBottom: "0.5rem" }}>1. Which columns should be added together?</label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
                      {editingTemplate.columns.slice(0, index).map((prevCol, i) => (
                        <label key={i} style={{ 
                          padding: "6px 12px", 
                          background: (col.calcSources || []).includes(prevCol.heading) ? "var(--primary)" : "var(--bg-secondary)", 
                          color: (col.calcSources || []).includes(prevCol.heading) ? "white" : "inherit",
                          borderRadius: "20px", cursor: "pointer", fontSize: "0.85rem", border: "1px solid var(--border-color)",
                          display: "flex", alignItems: "center", gap: "0.5rem"
                        }}>
                          <input 
                            type="checkbox" 
                            checked={(col.calcSources || []).includes(prevCol.heading)}
                            onChange={() => toggleCalcSource(index, prevCol.heading)}
                            style={{ display: "none" }}
                          />
                          {(col.calcSources || []).includes(prevCol.heading) && <Check size={14} />}
                          {prevCol.heading || `Column ${i+1}`}
                        </label>
                      ))}
                      {index === 0 && <span style={{ fontSize: "0.85rem", color: "var(--danger)" }}>No previous columns available to add!</span>}
                    </div>

                    <div style={{ display: "flex", gap: "1.5rem", alignItems: "center" }}>
                      <div>
                        <label style={{ fontSize: "0.85rem", fontWeight: "bold", display: "block", marginBottom: "0.5rem" }}>2. Total Max Marks of selected</label>
                        <input type="number" className="input-field" value={col.calcOutof} onChange={(e) => handleColumnChange(index, 'calcOutof', e.target.value)} style={{ width: "150px" }} />
                      </div>
                      <div style={{ fontSize: "1.5rem", color: "var(--text-muted)", marginTop: "1.5rem" }}>👉</div>
                      <div>
                        <label style={{ fontSize: "0.85rem", fontWeight: "bold", display: "block", marginBottom: "0.5rem" }}>3. Convert to Weightage</label>
                        <input type="number" className="input-field" value={col.calcWeightage} onChange={(e) => handleColumnChange(index, 'calcWeightage', e.target.value)} style={{ width: "150px" }} />
                      </div>
                    </div>
                    
                    <div style={{ marginTop: "1rem", padding: "10px", background: "rgba(16, 185, 129, 0.1)", color: "#10b981", borderRadius: "6px", fontSize: "0.85rem", fontWeight: "bold" }}>
                      Formula: ( Sum of Selected ) / {col.calcOutof} × {col.calcWeightage}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          
          <div style={{ display: "flex", gap: "1rem", marginTop: "1.5rem" }}>
            <button onClick={() => handleAddColumn("exam")} className="btn" style={{ background: "rgba(99, 102, 241, 0.1)", color: "var(--primary)", border: "1px dashed var(--primary)" }}>
              <Plus size={16} /> Add Exam Column
            </button>
            <button onClick={() => handleAddColumn("calculation")} className="btn" style={{ background: "rgba(16, 185, 129, 0.1)", color: "#10b981", border: "1px dashed #10b981" }}>
              <Calculator size={16} /> Add Calculated Column
            </button>
          </div>

          <div style={{ display: "flex", gap: "1rem", marginTop: "2rem", borderTop: "1px solid var(--border-color)", paddingTop: "1.5rem" }}>
            <button onClick={handleSaveTemplate} className="btn btn-primary" style={{ padding: "0.75rem 2rem", fontSize: "1rem" }}><Save size={18} style={{ marginRight: "8px" }} /> Save Template</button>
            <button onClick={() => setEditingTemplate(null)} className="btn btn-secondary" style={{ padding: "0.75rem 2rem", fontSize: "1rem" }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ensure Check is imported
import { Check } from "lucide-react";
