import React, { useState, useEffect } from "react";
import API from "../api";
import { Plus, Trash, Save, Check } from "lucide-react";

export default function InternalMarkTemplateSetup() {
  const [templates, setTemplates] = useState([]);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTemplates();
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

  const handleAddNewTemplate = () => {
    setEditingTemplate({
      templateName: "New Template",
      isActive: false,
      columns: [
        { heading: "UNIT I", type: "exam", examName: "UNIT I", formula: "" }
      ]
    });
  };

  const handleSaveTemplate = async () => {
    try {
      if (editingTemplate._id) {
        await API.put(`/api/internal-marks/${editingTemplate._id}`, editingTemplate);
      } else {
        await API.post("/api/internal-marks", editingTemplate);
      }
      setEditingTemplate(null);
      fetchTemplates();
      alert("Template saved successfully!");
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

  const handleAddColumn = () => {
    setEditingTemplate(prev => ({
      ...prev,
      columns: [...prev.columns, { heading: "New Column", type: "exam", examName: "", formula: "" }]
    }));
  };

  const handleColumnChange = (index, field, value) => {
    const newColumns = [...editingTemplate.columns];
    newColumns[index][field] = value;
    setEditingTemplate(prev => ({ ...prev, columns: newColumns }));
  };

  const handleRemoveColumn = (index) => {
    const newColumns = [...editingTemplate.columns];
    newColumns.splice(index, 1);
    setEditingTemplate(prev => ({ ...prev, columns: newColumns }));
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div className="card">
      <h2 style={{ marginBottom: "1rem" }}>Internal Mark Templates Setup</h2>
      
      {!editingTemplate ? (
        <div>
          <button onClick={handleAddNewTemplate} className="btn btn-primary" style={{ marginBottom: "1rem" }}>
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
                  <td>{t.templateName}</td>
                  <td>{t.isActive ? <span style={{ color: "green", fontWeight: "bold" }}>Active</span> : "Inactive"}</td>
                  <td>{t.columns.length} columns</td>
                  <td>
                    <button onClick={() => setEditingTemplate(t)} className="btn btn-secondary btn-sm" style={{ marginRight: "0.5rem" }}>Edit</button>
                    <button onClick={() => handleDeleteTemplate(t._id)} className="btn btn-danger btn-sm"><Trash size={14} /></button>
                  </td>
                </tr>
              ))}
              {templates.length === 0 && (
                <tr>
                  <td colSpan="4" style={{ textAlign: "center" }}>No templates found. Create one to get started.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem", alignItems: "center" }}>
            <input 
              type="text" 
              className="input-field" 
              value={editingTemplate.templateName}
              onChange={(e) => setEditingTemplate({ ...editingTemplate, templateName: e.target.value })}
              placeholder="Template Name (e.g. 2025-26 ODD SEM)"
              style={{ width: "300px" }}
            />
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input 
                type="checkbox" 
                checked={editingTemplate.isActive} 
                onChange={(e) => setEditingTemplate({ ...editingTemplate, isActive: e.target.checked })}
              />
              Set as Active Template
            </label>
          </div>

          <div style={{ background: "var(--bg-secondary)", padding: "1rem", borderRadius: "8px", marginBottom: "1rem" }}>
            <h4 style={{ marginBottom: "1rem" }}>Template Columns</h4>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
              <strong>Tip:</strong> For formula columns, use <code>#[Column Heading]</code> to refer to other columns. For example: <code>(#[UNIT I] + #[UNIT II] + #[CIA I]) / 110 * 10</code>.
            </p>
            
            {editingTemplate.columns.map((col, index) => (
              <div key={index} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem", alignItems: "flex-start", background: "var(--bg-main)", padding: "0.5rem", borderRadius: "4px" }}>
                <div style={{ width: "30px", paddingTop: "0.5rem", fontWeight: "bold" }}>{index + 1}.</div>
                <div style={{ flex: 1 }}>
                  <input 
                    type="text" 
                    className="input-field" 
                    placeholder="Column Heading (e.g. CIA I IM (10))" 
                    value={col.heading} 
                    onChange={(e) => handleColumnChange(index, 'heading', e.target.value)}
                    style={{ marginBottom: "0.5rem" }}
                  />
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <select 
                      className="input-field" 
                      value={col.type} 
                      onChange={(e) => handleColumnChange(index, 'type', e.target.value)}
                      style={{ width: "150px" }}
                    >
                      <option value="exam">Fetch from Exam</option>
                      <option value="formula">Formula Calculation</option>
                    </select>
                    
                    {col.type === "exam" && (
                      <input 
                        type="text" 
                        className="input-field" 
                        placeholder="Exact Exam Name in System (e.g. CIA - I)" 
                        value={col.examName} 
                        onChange={(e) => handleColumnChange(index, 'examName', e.target.value)}
                        style={{ flex: 1 }}
                      />
                    )}
                    
                    {col.type === "formula" && (
                      <input 
                        type="text" 
                        className="input-field" 
                        placeholder="e.g. (#[UNIT I] + #[UNIT II]) / 60 * 10" 
                        value={col.formula} 
                        onChange={(e) => handleColumnChange(index, 'formula', e.target.value)}
                        style={{ flex: 1 }}
                      />
                    )}
                  </div>
                </div>
                <button onClick={() => handleRemoveColumn(index)} className="btn btn-danger btn-sm" style={{ marginTop: "0.2rem" }}>
                  <X size={16} />
                </button>
              </div>
            ))}
            
            <button onClick={handleAddColumn} className="btn btn-secondary btn-sm" style={{ marginTop: "0.5rem" }}>
              <Plus size={14} /> Add Column
            </button>
          </div>

          <div style={{ display: "flex", gap: "1rem" }}>
            <button onClick={handleSaveTemplate} className="btn btn-primary"><Save size={16} /> Save Template</button>
            <button onClick={() => setEditingTemplate(null)} className="btn btn-secondary">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Ensure X is imported if used
import { X } from "lucide-react";
