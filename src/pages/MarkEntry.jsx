import { useState, useEffect, useRef } from "react";
import API from "../api";
import * as XLSX from "xlsx";
import headerLogo from "../assets/logo image.jpg";



const LocalMarkInput = ({ s, j, classData, printEditAccess, isEditingLockedByDate, handleMarkChange, handleKeyDown, i, inputRef, isAdmin }) => {
  const initialValue = (s.marks && s.marks[j]) || "";
  const [val, setVal] = useState(initialValue);
  const isSaving = useRef(false);

  useEffect(() => {
    setVal(initialValue);
  }, [initialValue]);

  const handleChange = (e) => {
    setVal(e.target.value);
  };

  const handleBlur = () => {
    if (val !== initialValue && !isSaving.current) {
      isSaving.current = true;
      const success = handleMarkChange(i, j, val);
      if (success === false) setVal(initialValue);
      setTimeout(() => { isSaving.current = false; }, 100);
    }
  };

  const handleKey = (e) => {
    if (e.key === "Enter" || e.keyCode === 13 || e.key.startsWith("Arrow")) {
      if (val !== initialValue && !isSaving.current) {
        isSaving.current = true;
        const success = handleMarkChange(i, j, val);
        if (success === false) {
          setVal(initialValue);
          e.preventDefault();
          setTimeout(() => { isSaving.current = false; }, 100);
          return;
        }
        setTimeout(() => { isSaving.current = false; }, 100);
      }
    }
    handleKeyDown(e, i, j);
  };

  const isFailed = s.marks && (
    classData.examName === "ESE" 
      ? (s.marks[j] === "AB" || s.marks[j] === "U" || s.marks[j] === "U*" || s.marks[j] === "FAIL" || s.marks[j] === "RA" || s.marks[j] === "SA" || s.marks[j] === "W" || s.marks[j] === "") 
      : (s.marks[j] === "AB" || s.marks[j] === "A" || (s.marks[j] !== "" && !isNaN(Number(s.marks[j])) && Number(s.marks[j]) < classData.passMark))
  );

  return (
    <input
      type="text"
      className="mark-input"
      enterKeyHint="next"
      style={{
        fontSize: "11px",
        height: "100%",
        width: "100%",
        border: "none",
        backgroundColor: "transparent",
        color: "black",
        WebkitPrintColorAdjust: "exact",
        printColorAdjust: "exact",
        display: "block",
        padding: "4px 0",
        fontWeight: isFailed ? "bold" : "normal",
        textAlign: "center"
      }}
      value={val}
      readOnly={!isAdmin && (classData.allowEditing === false || isEditingLockedByDate().locked || !printEditAccess)}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKey}
      ref={inputRef}
    />
  );
};

export default function MarkEntry() {
  const [classes, setClasses] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [classData, setClassData] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [filters, setFilters] = useState({ year: "I", semester: "I", section: "A", exam: "Unit Test - I" });
  const [printEditAccess, setPrintEditAccess] = useState(true);
  const [printBold, setPrintBold] = useState(false);
  const examNameOptions = [
    "Model Exam",
    "Model Practical Exam",
    "Unit Test - I", "Unit Test - II", "Unit Test - III", "Unit Test - IV", "Unit Test - V",
    "CIA - I", "CIA - II", "CIA - III",
    "MKC", "ESE"
  ];
  
  const dynamicExamNameOptions = Array.from(new Set([
    ...examNameOptions,
    ...(Array.isArray(classes) ? classes.map(c => c.examName) : [])
  ])).filter(Boolean);
  const [filteredClasses, setFilteredClasses] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState({ show: false, message: "", type: "loading" });
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const [lastAutoSave, setLastAutoSave] = useState(null);
  const isAdmin = (sessionStorage.getItem("role") || "").toLowerCase() === "admin";
  const [focusedSubjectIndices, setFocusedSubjectIndices] = useState([]); // empty means all
  const [focusDropdownOpen, setFocusDropdownOpen] = useState(false);

  const toggleSubjectFocus = (idx) => {
    setFocusedSubjectIndices(prev => {
      if (prev.includes(idx)) return prev.filter(i => i !== idx);
      return [...prev, idx];
    });
  };

  const inputRefs = useRef({});

  const formatDate = (dateStr) => {
    if (!dateStr) return "";
    const parts = dateStr.split("-");
    if (parts.length !== 3) return dateStr;
    const [year, month, day] = parts;
    return `${day}-${month}-${year}`;
  };

  const isEditingLockedByDate = () => {
    if (!classData) return { locked: false };
    const now = new Date();
    const istDate = new Date(now.getTime() + 19800000); // UTC + 5.5 hours
    const year = istDate.getUTCFullYear();
    const month = String(istDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(istDate.getUTCDate()).padStart(2, '0');
    const hours = String(istDate.getUTCHours()).padStart(2, '0');
    const minutes = String(istDate.getUTCMinutes()).padStart(2, '0');
    const todayStr = `${year}-${month}-${day}T${hours}:${minutes}`; // YYYY-MM-DDThh:mm
    
    if (classData.editingStartDate) {
      const startLimit = classData.editingStartDate + "T" + (classData.editingStartTime || "00:00");
      if (todayStr < startLimit) {
        return { locked: true, reason: `Mark entry is only allowed starting from ${formatDate(classData.editingStartDate)} ${classData.editingStartTime || "00:00"}.` };
      }
    }
    if (classData.editingEndDate) {
      const endLimit = classData.editingEndDate + "T" + (classData.editingEndTime || "23:59");
      if (todayStr > endLimit) {
        return { locked: true, reason: `Mark entry has expired on ${formatDate(classData.editingEndDate)} ${classData.editingEndTime || "23:59"}.` };
      }
    }
    return { locked: false };
  };

  const calculateSubjectStats = (subjectIndex) => {
    if (!classData || !classData.students || classData.students.length === 0) return { total: 0, pass: 0, fail: 0, passPercent: 0 };
    const students = classData.students;
    const total = students.length;
    let pass = 0;

    students.forEach(s => {
      const strVal = String((s.marks && s.marks[subjectIndex]) || "").toUpperCase().trim();
      if (classData.examName === "ESE") {
        if (strVal !== "AB" && strVal !== "U" && strVal !== "U*" && strVal !== "FAIL" && strVal !== "") {
          pass++;
        }
      } else {
        if (strVal === "A" || strVal === "AB") {
          // absent = fail
        } else {
          const mark = Number(strVal);
          if (!isNaN(mark) && mark >= classData.passMark) pass++;
        }
      }
    });

    const fail = total - pass;
    const passPercent = total === 0 ? 0 : Math.round((pass / total) * 100);
    return { total, pass, fail, passPercent };
  };

  const getStudentFocusedStats = (s) => {
    if (!classData) return { total: 0, percentage: 0, result: "-" };
    if (!focusedSubjectIndices || focusedSubjectIndices.length === 0) {
      return { total: s.total, percentage: s.percentage, result: s.result };
    }

    let total = 0;
    let totalGradePoints = 0;
    let totalCredits = 0;
    let fail = false;
    const isESE = classData.examName === "ESE";

    const getGradePoint = (grade, system) => {
      const g = String(grade).toUpperCase().trim();
      if (system === "System 1") {
        const map = { "S": 10, "A+": 9, "A": 8, "B+": 7, "B": 6.5, "C+": 6, "C": 5, "U": 0, "U*": 0 };
        return map[g] !== undefined ? map[g] : 0;
      } else {
        const map = { "O": 10, "A+": 9, "A": 8, "B+": 7, "B": 6, "C": 5, "U": 0, "U*": 0 };
        return map[g] !== undefined ? map[g] : 0;
      }
    };

    (s.marks || []).forEach((val, idx) => {
      if (!focusedSubjectIndices.includes(idx)) return; // Skip ignored subjects

      const markStr = String(val || "").toUpperCase().trim();
      if (isESE) {
        if (markStr === "AB" || markStr === "U" || markStr === "U*" || markStr === "FAIL" || markStr === "") {
          fail = true;
        }
        const gp = getGradePoint(markStr, classData.eseGradingSystem || "System 2");
        const credits = (classData.courseDetails && classData.courseDetails[idx] && classData.courseDetails[idx].credits !== undefined) ? Number(classData.courseDetails[idx].credits) : 3;
        totalGradePoints += (gp * credits);
        totalCredits += credits;
      } else {
        if (markStr === "AB" || markStr === "A") {
          fail = true;
        } else {
          const numVal = Number(markStr || 0);
          total += (isNaN(numVal) ? 0 : numVal);
          if (numVal < classData.passMark) fail = true;
        }
      }
    });

    const maxTotal = isESE ? focusedSubjectIndices.length * 10 : focusedSubjectIndices.length * classData.markPerSubject;
    let percentage = maxTotal > 0 ? (total / maxTotal) * 100 : 0;

    if (isESE) {
      total = totalCredits > 0 ? Number((totalGradePoints / totalCredits).toFixed(2)) : 0;
      percentage = Math.round(total * 10);
    } else {
      total = Math.round(total);
    }

    return {
      total,
      percentage: Number(percentage.toFixed(2)),
      result: fail ? "Fail" : "Pass"
    };
  };

  const getOverallPassPercent = () => {
    if (!classData || !classData.students || classData.students.length === 0) return 0;
    const total = classData.students.length;
    let pass = 0;
    classData.students.forEach(s => {
      const stats = getStudentFocusedStats(s);
      if (stats.result === "Pass") pass++;
    });
    return total === 0 ? 0 : Math.round((pass / total) * 100);
  };

  useEffect(() => {
    loadClasses();
    if (sessionStorage.getItem("role") === "printAdmin") {
      API.get("/api/auth/admin/print-access", {
        headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` }
      })
      .then(res => setPrintEditAccess(res.data.printEditAccess))
      .catch(err => console.error(err));
    }
  }, []);

  async function loadClasses() {
    try {
      const res = await API.get("/api/classes");
      setClasses(res.data);
      applyFilters(res.data, filters);
    } catch (err) {
      console.error(err);
    }
  }

  const loadSpecificClassData = async (name, allClasses) => {
    const cls = allClasses ? allClasses.find(c => c.className === name) : classes.find(c => c.className === name);
    if (!cls) return;
    try {
      const res = await API.get(`/api/classes/${encodeURIComponent(name)}`);
      let updatedStudents = res.data.students.map(s => {
        if (!s.marks || s.marks.length !== res.data.subjects.length) {
          return { ...s, marks: Array(res.data.subjects.length).fill("") };
        }
        return s;
      });

      updatedStudents.sort((a, b) => a.regNo.localeCompare(b.regNo, undefined, { numeric: true, sensitivity: 'base' }));

      let cleanedCourseDetails = (res.data.courseDetails || []).map(cd => {
        if (cd.courseCode && cd.courseCode.includes(' & ')) {
          const parts = cd.courseCode.split(' & ');
          return { 
            courseCode: parts[0].trim(), 
            courseName: cd.courseName || parts[1]?.trim() || "", 
            shortName: cd.shortName || "",
            facultyName: cd.facultyName || "",
            credits: cd.credits !== undefined ? cd.credits : 3
          };
        }
        return {
          ...cd,
          shortName: cd.shortName || "",
          credits: cd.credits !== undefined ? cd.credits : 3
        };
      });

      const fullClassData = { ...res.data, courseDetails: cleanedCourseDetails };

      const getGradePoint = (grade, system) => {
        const g = String(grade).toUpperCase().trim();
        if (system === "System 1") {
          const map = { "S": 10, "A+": 9, "A": 8, "B+": 7, "B": 6.5, "C+": 6, "C": 5, "U": 0, "U*": 0 };
          return map[g] !== undefined ? map[g] : 0;
        } else {
          const map = { "O": 10, "A+": 9, "A": 8, "B+": 7, "B": 6, "C": 5, "U": 0, "U*": 0 };
          return map[g] !== undefined ? map[g] : 0;
        }
      };

      updatedStudents = updatedStudents.map(s => {
        let total = 0;
        let totalGradePoints = 0;
        let totalCredits = 0;
        let fail = false;
        const isESE = fullClassData.examName === "ESE";

        s.marks = [...s.marks];
        s.marks.forEach((val, idx) => {
          let markStr = String(val || "").toUpperCase().trim();
          
          if (!isESE && markStr !== "" && markStr !== "A" && markStr !== "AB") {
            const numVal = Number(markStr);
            if (!isNaN(numVal)) {
               markStr = Math.round(numVal).toString();
               s.marks[idx] = markStr;
            }
          }

          if (isESE) {
            if (markStr === "AB" || markStr === "U" || markStr === "U*" || markStr === "FAIL" || markStr === "") {
              fail = true;
            }
            const gp = getGradePoint(markStr, fullClassData.eseGradingSystem || "System 2");
            const credits = (fullClassData.courseDetails && fullClassData.courseDetails[idx] && fullClassData.courseDetails[idx].credits !== undefined) ? Number(fullClassData.courseDetails[idx].credits) : 3;
            totalGradePoints += (gp * credits);
            totalCredits += credits;
          } else {
            if (markStr === "AB" || markStr === "A") {
              fail = true;
            } else {
              const numVal = Number(markStr || 0);
              total += (isNaN(numVal) ? 0 : numVal);
              if (numVal < fullClassData.passMark) fail = true;
            }
          }
        });

        const maxTotal = isESE ? fullClassData.subjects.length * 10 : fullClassData.subjects.length * fullClassData.markPerSubject;
        let percentage = maxTotal > 0 ? (total / maxTotal) * 100 : 0;

        if (isESE) {
          total = totalCredits > 0 ? Number((totalGradePoints / totalCredits).toFixed(2)) : 0;
          percentage = Math.round(total * 10);
        } else {
          total = Math.round(total);
        }

        return {
          ...s,
          total,
          percentage: Math.round(percentage),
          result: fail ? "Fail" : "Pass"
        };
      });

      setClassData({ ...fullClassData, students: updatedStudents });
    } catch (err) {
      console.error(err);
    }
  };

  const applyFilters = (allClasses, f) => {
    const targetYSS = `${f.year}/${f.semester}/${f.section}`;
    // Filter by yearSemSec AND examName
    const filtered = allClasses.filter(c => {
      const yssMatch = c.yearSemSec === targetYSS;
      const examMatch = !f.exam || c.examName === f.exam;
      return yssMatch && examMatch;
    });
    setFilteredClasses(filtered);

    if (filtered.length === 1) {
      // Exact single match — auto-load
      const firstClassName = filtered[0].className;
      setSelectedClassId(firstClassName);
      loadSpecificClassData(firstClassName, allClasses);
    } else if (filtered.length > 1) {
      // Multiple matches — let user pick from dropdown
      setSelectedClassId("");
      setClassData(null);
    } else {
      setSelectedClassId("");
      setClassData(null);
    }
  };

  const getSemOptionsForYear = (year) => {
    switch (year) {
      case "I":
        return ["I", "II"];
      case "II":
        return ["III", "IV"];
      case "III":
        return ["V", "VI"];
      case "IV":
        return ["VII", "VIII"];
      default:
        return ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];
    }
  };

  const handleFilterChange = (field, val) => {
    let newFilters = { ...filters, [field]: val };
    if (field === 'year') {
      const year = val;
      const sem = filters.semester;
      let validatedSem = sem;
      if (year === "I" && !["I", "II"].includes(sem)) validatedSem = "I";
      else if (year === "II" && !["III", "IV"].includes(sem)) validatedSem = "III";
      else if (year === "III" && !["V", "VI"].includes(sem)) validatedSem = "V";
      else if (year === "IV" && !["VII", "VIII"].includes(sem)) validatedSem = "VII";
      newFilters.semester = validatedSem;
    }
    setFilters(newFilters);
    applyFilters(classes, newFilters);
  };

  const _handleClassSelect = (e) => {
    const name = e.target.value;
    setSelectedClassId(name);
    if (!name) {
      setClassData(null);
      return;
    }
    loadSpecificClassData(name);
  };

  const _toggleShowAll = () => {
    const nextShowAll = !showAll;
    setShowAll(nextShowAll);
    const targetYSS = `${filters.year}/${filters.semester}/${filters.section}`;
    const filtered = nextShowAll ? classes : classes.filter(c => c.yearSemSec === targetYSS);
    setFilteredClasses(filtered);
    if (filtered.length > 0) {
      setSelectedClassId(filtered[0].className);
      loadSpecificClassData(filtered[0].className, classes);
    }
  };

  const handleMarkChange = (studentIndex, subjectIndex, value) => {
    if (!classData || (!isAdmin && (classData.allowEditing === false || isEditingLockedByDate().locked || !printEditAccess))) return false;

    let strVal = value.toUpperCase();
    
    if (classData.examName === "ESE") {
      const sys1Grades = ["S", "A+", "A", "B+", "B", "C+", "C", "U", "U*"];
      const sys2Grades = ["O", "A+", "A", "B+", "B", "C", "U", "U*"];
      const validGrades = classData.eseGradingSystem === "System 1" ? sys1Grades : sys2Grades;
      if (strVal !== "" && !validGrades.includes(strVal)) {
        alert(`Invalid grade '${strVal}' for ${classData.eseGradingSystem || "this system"}.\nAllowed grades: ${validGrades.join(", ")}`);
        const newStudents = [...classData.students];
        newStudents[studentIndex].marks[subjectIndex] = "";
        setClassData({ ...classData, students: newStudents });
        return false;
      }
    } else {
      if (strVal !== "" && strVal !== "A" && strVal !== "AB") {
        let numVal = Number(value);
        if (isNaN(numVal) || numVal < 0 || numVal > classData.markPerSubject) {
          if (isNaN(numVal)) {
            alert(`Invalid entry '${strVal}'. Only numbers, 'A' or 'AB' are allowed.`);
          } else if (numVal > classData.markPerSubject) {
            alert(`Max mark is ${classData.markPerSubject}`);
          }
          const newStudents = [...classData.students];
          newStudents[studentIndex].marks[subjectIndex] = "";
          setClassData({ ...classData, students: newStudents });
          return false;
        } else {
          strVal = Math.round(numVal).toString();
        }
      }
    }

    const newStudents = [...classData.students];
    const s = newStudents[studentIndex];
    s.marks[subjectIndex] = strVal;

    // Live calculation
    let total = 0;
    let totalGradePoints = 0;
    let totalCredits = 0;
    let fail = false;
    const isESE = classData.examName === "ESE";

    const getGradePoint = (grade, system) => {
      const g = String(grade).toUpperCase().trim();
      if (system === "System 1") {
        const map = { "S": 10, "A+": 9, "A": 8, "B+": 7, "B": 6.5, "C+": 6, "C": 5, "U": 0, "U*": 0 };
        return map[g] !== undefined ? map[g] : 0;
      } else {
        const map = { "O": 10, "A+": 9, "A": 8, "B+": 7, "B": 6, "C": 5, "U": 0, "U*": 0 };
        return map[g] !== undefined ? map[g] : 0;
      }
    };

    s.marks.forEach((val, idx) => {
      const markStr = String(val || "").toUpperCase().trim();
      if (isESE) {
        if (markStr === "AB" || markStr === "U" || markStr === "U*" || markStr === "FAIL" || markStr === "") {
          fail = true;
        }
        const gp = getGradePoint(markStr, classData.eseGradingSystem || "System 2");
        const credits = (classData.courseDetails && classData.courseDetails[idx] && classData.courseDetails[idx].credits !== undefined) ? Number(classData.courseDetails[idx].credits) : 3;
        totalGradePoints += (gp * credits);
        totalCredits += credits;
      } else {
        if (markStr === "AB" || markStr === "A") {
          fail = true;
        } else {
          const numVal = Number(markStr || 0);
          total += (isNaN(numVal) ? 0 : numVal);
          if (numVal < classData.passMark) fail = true;
        }
      }
    });

    const maxTotal = isESE ? classData.subjects.length * 10 : classData.subjects.length * classData.markPerSubject;
    let percentage = maxTotal > 0 ? (total / maxTotal) * 100 : 0;

    if (isESE) {
      total = totalCredits > 0 ? Number((totalGradePoints / totalCredits).toFixed(2)) : 0;
      percentage = Math.round(total * 10);
    } else {
      total = Math.round(total);
    }

    s.total = total;
    s.percentage = Number(percentage.toFixed(2));
    s.result = fail ? "Fail" : "Pass";

    setClassData({ ...classData, students: newStudents });
    setUnsavedChanges(true);
    return true;
  };

  const _handleAttendanceChange = (studentIndex, value) => {
    if (!classData || (!isAdmin && (classData.allowEditing === false || isEditingLockedByDate().locked))) return;
    const newStudents = [...classData.students];
    newStudents[studentIndex].attendance = value;
    setClassData({ ...classData, students: newStudents });
    setUnsavedChanges(true);
  };

  const handleKeyDown = (e, i, j) => {
    if (!classData) return;
    const { key, keyCode } = e;

    if (["Enter", "ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(key) || keyCode === 13) {
      e.preventDefault();
    }

    let nextRow = i;
    let nextCol = j;

    if (key === "Enter" || keyCode === 13) {
      if (i + 1 < classData.students.length) {
        nextRow = i + 1;
      } else if (j + 1 < classData.subjects.length) {
        // Wrap to the top of the next subject column
        nextRow = 0;
        nextCol = j + 1;
      }
    } else if (key === "ArrowRight") {
      if (j + 1 < classData.subjects.length) {
        nextCol = j + 1;
      } else if (i + 1 < classData.students.length) {
        nextRow = i + 1;
        nextCol = -1;
      }
    } else if (key === "ArrowLeft") {
      if (j > -1) {
        nextCol = j - 1;
      } else if (i > 0) {
        nextRow = i - 1;
        nextCol = classData.subjects.length - 1;
      }
    } else if (key === "ArrowDown") {
      if (i + 1 < classData.students.length) nextRow = i + 1;
    } else if (key === "ArrowUp") {
      if (i > 0) nextRow = i - 1;
    }

    const nextId = `${nextRow}_${nextCol}`;
    if (nextRow !== i || nextCol !== j) {
      if (inputRefs.current[nextId]) {
        inputRefs.current[nextId].focus();
        // Select text so they can easily overwrite it
        setTimeout(() => {
          if (inputRefs.current[nextId]) {
            inputRefs.current[nextId].select();
          }
        }, 10);
      }
    }
  };

  const handleExcelUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if ((sessionStorage.getItem("role") || "").toLowerCase() !== "admin") {
      alert("Only Admin can upload marks.");
      e.target.value = null;
      return;
    }

    if (!isAdmin && (classData.allowEditing === false || isEditingLockedByDate().locked || !printEditAccess)) {
      alert("Editing is currently locked or you don't have access.");
      e.target.value = null;
      return;
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = evt.target.result;
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        const headerRow = json[0] || [];
        
        let regNoIdx = -1;
        const subjectColMap = {}; // Maps subject index in classData.subjects to Excel column index

        headerRow.forEach((h, i) => {
          const val = (h || "").toString().toUpperCase().trim();
          if (val.includes("REGISTER NO") || val.includes("REG NO") || val === "REGNO") regNoIdx = i;
          else {
            const codeStr = val.replace(/[^A-Z0-9]/g, '');
            // Check if this matches any of the class subjects
            const subIdx = classData.subjects.findIndex((s, idx) => {
               const subjectStr = (s || "").toString().toUpperCase();
               
               // Exact match on alphanumeric stripped
               if (subjectStr.replace(/[^A-Z0-9]/g, '') === codeStr) return true;
               
               // Check if header value is part of the subject string (e.g. "OOPS" in "25CSC21 - OOPS")
               // Avoid false positives by ensuring val is at least 2 characters long
               if (val.length >= 2 && subjectStr.includes(val)) return true;
               
               // Check courseDetails if available
               if (classData.courseDetails && classData.courseDetails[idx]) {
                   const cd = classData.courseDetails[idx];
                   if (cd.courseCode && cd.courseCode.toUpperCase().replace(/[^A-Z0-9]/g, '') === codeStr) return true;
                   if (cd.shortName && cd.shortName.toUpperCase().replace(/[^A-Z0-9]/g, '') === codeStr) return true;
                   if (cd.courseName && cd.courseName.toUpperCase().replace(/[^A-Z0-9]/g, '') === codeStr) return true;
               }
               return false;
            });
            if (subIdx !== -1) {
              subjectColMap[subIdx] = i;
            }
          }
        });

        if (regNoIdx === -1) {
          alert("Invalid Excel format: Could not find 'REGISTER NO' or 'REG NO' column.");
          return;
        }

        let isFallback = false;
        if (Object.keys(subjectColMap).length === 0) {
           isFallback = true;
           let startIdx = regNoIdx + 1;
           headerRow.forEach((h, i) => {
              const val = (h || "").toString().toUpperCase().trim();
              if (val.includes("NAME")) startIdx = Math.max(startIdx, i + 1);
           });
           
           classData.subjects.forEach((sub, subIdx) => {
             if (startIdx + subIdx < headerRow.length) {
               subjectColMap[subIdx] = startIdx + subIdx;
             }
           });
        }

        const excelDataMap = {};
        for (let i = 1; i < json.length; i++) {
          const row = json[i];
          if (!row[regNoIdx]) continue;
          const regNo = row[regNoIdx].toString().trim().toLowerCase();
          excelDataMap[regNo] = row;
        }

        const newStudents = [...classData.students];
        let matchCount = 0;

        newStudents.forEach(s => {
          const regNo = (s.regNo || "").toString().trim().toLowerCase();
          const excelRow = excelDataMap[regNo];
          if (excelRow) {
            matchCount++;
            if (!s.marks) s.marks = new Array(classData.subjects.length).fill("");
            
            classData.subjects.forEach((sub, subIdx) => {
              const excelColIdx = subjectColMap[subIdx];
              if (excelColIdx !== undefined) {
                let markVal = (excelRow[excelColIdx] || "").toString().trim().toUpperCase();
                
                if (markVal === "") {
                  // Preserve existing mark if excel cell is completely empty
                  markVal = s.marks[subIdx];
                } else if (markVal === "UNDEFINED" || markVal === "NULL" || markVal === "CLEAR") {
                  // Explicitly allow clearing a mark
                  markVal = "";
                }
                
                if (classData.examName === "ESE" && markVal !== "") {
                  const sys1Grades = ["S", "A+", "A", "B+", "B", "C+", "C", "U", "U*"];
                  const sys2Grades = ["O", "A+", "A", "B+", "B", "C", "U", "U*"];
                  const validGrades = classData.eseGradingSystem === "System 1" ? sys1Grades : sys2Grades;
                  if (!validGrades.includes(markVal)) {
                    markVal = s.marks[subIdx]; // Reject invalid grade by keeping original
                  }
                } else if (classData.examName !== "ESE" && markVal !== "") {
                  if (markVal !== "A" && markVal !== "AB") {
                    let numVal = Number(markVal);
                    if (!isNaN(numVal)) {
                      markVal = Math.round(numVal).toString();
                    }
                  }
                }
                
                s.marks[subIdx] = markVal;
              }
            });
          }
        });

        setClassData({ ...classData, students: newStudents });
        setUnsavedChanges(true);
        
        let msg = `Successfully imported marks for ${matchCount} students from Excel.`;
        if (isFallback) msg += " (Mapped marks by column order as course codes were not found in header)";
        msg += "\n\nPlease click 'Save Marks' to save these changes to the database.";
        
        alert(msg);
      } catch (err) {
        alert("Failed to process Excel file: " + err.message);
      }
      e.target.value = null; // reset
    };
    reader.readAsArrayBuffer(file);
  };

  // Auto-save logic
  useEffect(() => {
    if (unsavedChanges && classData) {
      const timer = setTimeout(() => {
        silentAutoSave(classData);
      }, 1500); // 1.5 seconds of inactivity triggers auto-save
      return () => clearTimeout(timer);
    }
  }, [classData, unsavedChanges]);

  const silentAutoSave = async (dataToSave) => {
    if (!dataToSave || (!isAdmin && (dataToSave.allowEditing === false || !printEditAccess))) return;
    const dateLock = isEditingLockedByDate();
    if (!isAdmin && dateLock.locked) return;

    try {
      await API.post(`/api/classes/${encodeURIComponent(dataToSave.className)}/marks`, {
        students: dataToSave.students,
        isAdmin: isAdmin
      });

      // Save Attendance
      const attendanceMap = {};
      let hasAttendance = false;
      dataToSave.students.forEach(s => {
        if (s.attendance !== undefined && s.attendance !== "") {
          attendanceMap[s.regNo] = s.attendance;
          hasAttendance = true;
        }
      });
      if (hasAttendance) {
        await API.post(`/api/classes/${encodeURIComponent(dataToSave.className)}/attendance`, {
          attendanceMap,
          isAdmin: isAdmin
        });
      }

      setUnsavedChanges(false);
      setLastAutoSave(new Date());
    } catch (err) {
      console.error("Auto-save failed", err);
    }
  };

  const handleSave = async () => {
    if (!classData) return;
    if (!isAdmin && (classData.allowEditing === false || !printEditAccess)) {
      alert("Entry is currently locked by Administrator.");
      return;
    }
    const dateLock = isEditingLockedByDate();
    if (!isAdmin && dateLock.locked) {
      alert(dateLock.reason);
      return;
    }
    setIsSaving(true);
    setToast({ show: true, message: "Your marks are in progress... Please wait 🚀", type: "loading" });
    try {
      await API.post(`/api/classes/${encodeURIComponent(classData.className)}/marks`, {
        students: classData.students,
        isAdmin: isAdmin
      });

      // Save Attendance
      const attendanceMap = {};
      let hasAttendance = false;
      classData.students.forEach(s => {
        if (s.attendance !== undefined && s.attendance !== "") {
          attendanceMap[s.regNo] = s.attendance;
          hasAttendance = true;
        }
      });
      if (hasAttendance) {
        await API.post(`/api/classes/${encodeURIComponent(classData.className)}/attendance`, {
          attendanceMap,
          isAdmin: isAdmin
        });
      }

      const userId = sessionStorage.getItem("userId");
      const userName = sessionStorage.getItem("userName") || "Admin";
      if (userId) {
        try {
          await API.post("/api/auth/activity", {
            userId, userName, action: "submit",
            details: `Submitted marks for ${classData.className}`
          });
        } catch (e) { console.error(e); }
      }

      const res = await API.get(`/api/classes/${encodeURIComponent(classData.className)}`);
      // Important to reload exactly the newly saved data
      const updatedStudentsReload = res.data.students.map(s => {
        return {
          ...s,
          marks: s.marks || Array(res.data.subjects.length).fill("")
        };
      });
      setClassData({ ...res.data, students: updatedStudentsReload });
      
      setUnsavedChanges(false);
      setLastAutoSave(new Date());
      
      setToast({ show: true, message: "Awesome! Marks successfully saved! 🎉", type: "success" });
      setTimeout(() => setToast({ show: false, message: "", type: "" }), 4000);
    } catch (err) {
      setToast({ show: true, message: "Failed to save: " + err.message, type: "error" });
      setTimeout(() => setToast({ show: false, message: "", type: "" }), 5000);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRequestExtension = async () => {
    if (!classData) return;
    try {
      setToast({ show: true, message: "Submitting request...", type: "loading" });
      const facultyName = sessionStorage.getItem("userName") || "Faculty";
      const facultyId = sessionStorage.getItem("userId") || "Unknown ID";
      await API.post("/api/extensions/request", {
        classId: classData._id,
        className: classData.className,
        facultyName,
        facultyId
      });
      setToast({ show: true, message: "Extension request submitted successfully! 🎉", type: "success" });
      setTimeout(() => setToast({ show: false, message: "", type: "" }), 4000);
    } catch (err) {
      setToast({ show: true, message: "Failed to submit request: " + (err.response?.data?.error || err.message), type: "error" });
      setTimeout(() => setToast({ show: false, message: "", type: "" }), 5000);
    }
  };

  // Get display date from admin
  const getDisplayDate = () => {
    if (classData && classData.date) return classData.date;
    return new Date().toLocaleDateString('en-GB').replace(/\//g, '.');
  };

  // Get course details with fallback
  const getCourseDetails = () => {
    if (!classData) return [];
    if (classData.courseDetails && classData.courseDetails.length > 0) return classData.courseDetails;
    return (classData.subjects || []).map(s => ({ courseCode: s, courseName: "", facultyName: "" }));
  };

  const handleExportExcel = () => {
    if (!classData) return;
    try {
      console.log("Structured Excel export started...");
      const wb = XLSX.utils.book_new();
      const courseDetails = getCourseDetails();

      // Build 2D array for structured layout
      const aoa = [
        ["MUTHAYAMMAL ENGINEERING COLLEGE"],
        ["(Autonomous)"],
        ["OFFICE OF THE CONTROLLER OF EXAMINATIONS"],
        [`${classData.examName === "ESE" ? "End Semester Examination" : classData.examName} MARK STATEMENT`],
        [`Department : ${classData.department || "CSE"}`, "", `Class : ${classData.className.trim()}`, "", `Date: ${getDisplayDate()}`],
        [] // empty row
      ];

      // Header Row
      const headerRow = ["S.No.", "Register Number", "Name of the Student"];
      classData.subjects.forEach((sub, j) => {
        headerRow.push(courseDetails[j]?.courseCode || sub);
      });
      headerRow.push(classData.examName === "ESE" ? "SGPA" : "Total Marks", "Pass %", "Pass/Fail");
      aoa.push(headerRow);

      // Student Data Rows
      classData.students.forEach((s, i) => {
        const row = [i + 1, s.regNo, s.name];
        classData.subjects.forEach((sub, j) => {
          row.push(s.marks ? s.marks[j] : "-");
        });
        row.push(s.total, s.percentage, s.result === "Pass" ? "P" : "F");
        aoa.push(row);
      });

      // Summary Rows for Excel
      const totalRow = ["", "", "Total"];
      const passRow = ["", "", "Pass"];
      const failRow = ["", "", "Fail"];
      const passPctRow = ["", "", "Pass %"];

      classData.subjects.forEach((_, j) => {
        const stats = calculateSubjectStats(j);
        totalRow.push(stats.total);
        passRow.push(stats.pass);
        failRow.push(stats.fail);
        passPctRow.push(stats.passPercent);
      });

      aoa.push(totalRow, passRow, failRow, passPctRow);

      aoa.push([]); // spacer row

      // Summary
      aoa.push(["PASS % : TARGET", classData.targetPassPercentage || 85]);
      aoa.push(["Overall Pass %", getOverallPassPercent()]);

      aoa.push([]); // spacer row

      // Faculty Table
      aoa.push(["S.No.", "COURSE CODE", "COURSE NAME", "NAME OF THE FACULTY", "PASS %", "SIGNATURE"]);
      courseDetails.forEach((c, i) => {
        const stats = calculateSubjectStats(i);
        aoa.push([i + 1, c.courseCode, c.courseName, c.facultyName, stats.passPercent, ""]);
      });

      const ws = XLSX.utils.aoa_to_sheet(aoa);

      // Basic Column Widths
      ws["!cols"] = [
        { wch: 6 },  // S.No
        { wch: 15 }, // RegNo
        { wch: 25 }, // Name
        ...(classData.subjects || []).map(() => ({ wch: 10 })), // Subjects
        { wch: 10 }, // Total
        { wch: 8 },  // %
        { wch: 8 }   // P/F
      ];

      XLSX.utils.book_append_sheet(wb, ws, "Mark Statement");
      XLSX.writeFile(wb, `${classData.className}_Mark_Statement.xlsx`);
      console.log("Structured Excel export completed.");
    } catch (err) {
      console.error("Structured Excel Export Error:", err);
      alert("Failed to download structured excel: " + err.message);
    }
  };




  return (
    <div className="page-layout faculty-mark-entry-container">
      <h1 style={{ marginBottom: "1.5rem" }}>Mark Entry</h1>
      
      <div className="filter-row">
        <div>
          <label className="input-label">Year</label>
          <select 
            value={filters.year} 
            onChange={e => handleFilterChange('year', e.target.value)} 
            className="select-input"
          >
            {["I", "II", "III", "IV"].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label className="input-label">Semester</label>
          <select 
            value={filters.semester} 
            onChange={e => handleFilterChange('semester', e.target.value)} 
            className="select-input"
          >
            {getSemOptionsForYear(filters.year).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="input-label">Section</label>
          <select 
            value={filters.section} 
            onChange={e => handleFilterChange('section', e.target.value)} 
            className="select-input"
          >
            {["A", "B", "C", "D", "E"].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="input-label">Evaluation Module</label>
          <select 
            value={filters.exam} 
            onChange={e => handleFilterChange('exam', e.target.value)} 
            className="select-input"
          >
            {dynamicExamNameOptions.map(opt => <option key={opt} value={opt}>{opt === "ESE" ? "End Semester Examination" : opt}</option>)}
          </select>
        </div>
      </div>

      {/* Multiple matches — show dropdown to pick */}
      {filteredClasses.length > 1 && (
        <div style={{ 
          marginTop: "15px", 
          padding: "15px 20px", 
          background: "var(--bg-card)", 
          border: "1px solid var(--border-color)", 
          borderRadius: "12px",
          display: "flex",
          alignItems: "center",
          gap: "15px",
          boxShadow: "var(--shadow-sm)"
        }}>
          <label style={{ fontWeight: "bold", color: "var(--primary)" }}>Select Class:</label>
          <select
            value={selectedClassId}
            onChange={e => { setSelectedClassId(e.target.value); loadSpecificClassData(e.target.value, classes); }}
            className="select-input"
          >
            <option value="">-- Select a Class --</option>
            {filteredClasses.map(c => (
              <option key={c._id} value={c.className}>{c.className}</option>
            ))}
          </select>
        </div>
      )}

      {filteredClasses.length === 0 && (
        <div style={{ 
          padding: "20px", 
          background: "rgba(239, 68, 68, 0.08)", 
          color: "var(--danger)", 
          borderRadius: "12px", 
          border: "1px solid rgba(239, 68, 68, 0.3)", 
          marginTop: "15px",
          display: "flex",
          alignItems: "flex-start",
          gap: "12px"
        }}>
          <span style={{ fontSize: "20px" }}>⚠️</span>
          <div>
            <strong style={{ display: "block", marginBottom: "4px" }}>No class setup found!</strong>
            <span style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>Please ensure you have created a class for this Year/Sem/Sec/<strong>{filters.exam}</strong> in the <strong>Admin Panel</strong> first.</span>
          </div>
        </div>
      )}

      {!classData ? (
        <div style={{ 
          textAlign: "center", 
          marginTop: "40px", 
          padding: "50px", 
          background: "var(--bg-card)", 
          borderRadius: "16px", 
          border: "1px dashed var(--border-color)",
          color: "var(--text-muted)", 
          fontWeight: "500",
          fontSize: "1.05rem"
        }}>
          <div style={{ fontSize: "42px", marginBottom: "15px" }}>📊</div>
          Please select Year, Semester, Section, and Exam Module to load the mark entry sheet.
        </div>
      ) : (
        <>
          {/* Custom Toast Notification */}
          {toast.show && (
            <div style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              zIndex: 9999,
              background: toast.type === "success" ? "#4caf50" : toast.type === "error" ? "#f44336" : "#007bff",
              color: "white",
              padding: "15px 30px",
              borderRadius: "8px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
              display: "flex",
              alignItems: "center",
              gap: "12px",
              fontWeight: "bold",
              fontSize: "16px",
              animation: "toastFadeIn 0.3s ease-out"
            }}>
              {toast.type === "loading" && <div style={{ animation: "toastSpin 1s linear infinite", fontSize: "20px" }}>⏳</div>}
              {toast.type === "success" && <div style={{ fontSize: "20px" }}>✅</div>}
              {toast.type === "error" && <div style={{ fontSize: "20px" }}>❌</div>}
              {toast.message}
            </div>
          )}

          <div className="print-no-margin" style={{ marginTop: "20px" }}>
          {(!isAdmin && (classData.allowEditing === false || isEditingLockedByDate().locked || !printEditAccess)) && (
            <div className="no-print" style={{ padding: "12px 20px", background: "rgba(239, 68, 68, 0.15)", color: "#e11d48", borderRadius: "8px", border: "1px solid #fb7185", marginBottom: "20px", display: "flex", alignItems: "center", gap: "10px", fontWeight: "700" }}>
              <span>🔒 ENTRY LOCKED:</span>
              <span style={{ fontWeight: "400", fontSize: "0.9rem", flex: 1 }}>
                {!isAdmin && classData.allowEditing === false 
                  ? "Administrator has restricted mark entry for this session. Changes cannot be saved."
                  : !printEditAccess
                    ? "Read-only mode enabled by Administrator."
                    : isEditingLockedByDate().reason}
              </span>
              { (!isAdmin && (classData.allowEditing === false || isEditingLockedByDate().locked)) && (
                <button
                  onClick={handleRequestExtension}
                  style={{
                    padding: "6px 12px",
                    background: "#e11d48",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "12px",
                    fontWeight: "bold"
                  }}
                >
                  Request Time Extension
                </button>
              )}
            </div>
          )}

          {classData.allowEditing !== false && printEditAccess && !isEditingLockedByDate().locked && (classData.editingStartDate || classData.editingEndDate) && (
            <div className="no-print" style={{ padding: "12px 20px", background: "rgba(16, 185, 129, 0.15)", color: "#047857", borderRadius: "8px", border: "1px solid #34d399", marginBottom: "20px", display: "flex", alignItems: "center", gap: "10px", fontWeight: "700" }}>
              <span>📅 MARK ENTRY DURATION:</span>
              <span style={{ fontWeight: "400", fontSize: "0.9rem" }}>
                {classData.editingStartDate && classData.editingEndDate 
                  ? `Allowed from ${formatDate(classData.editingStartDate)} ${classData.editingStartTime || "00:00"} to ${formatDate(classData.editingEndDate)} ${classData.editingEndTime || "23:59"}.`
                  : classData.editingStartDate 
                    ? `Allowed starting from ${formatDate(classData.editingStartDate)} ${classData.editingStartTime || "00:00"}.`
                    : `Allowed until ${formatDate(classData.editingEndDate)} ${classData.editingEndTime || "23:59"}.`}
              </span>
            </div>
          )}

          {!printEditAccess && (
            <div className="lock-banner" style={{ background: "rgba(56, 189, 248, 0.15)", color: "#38bdf8", padding: "10px", textAlign: "center", borderRadius: "8px", border: "1px solid rgba(56, 189, 248, 0.3)", marginBottom: "15px", fontWeight: "bold" }}>
              🖨️ View & Print Only Mode (Edit Access Disabled by Admin)
            </div>
          )}

          {/* Focus Mode Subject Selector */}
          <div className="no-print" style={{ 
            marginBottom: "20px", 
            padding: "15px", 
            background: "var(--bg-card)", 
            borderRadius: "12px", 
            border: "1px solid var(--border-color)",
            display: "inline-flex",
            alignItems: "center",
            gap: "15px",
            boxShadow: "var(--shadow-sm)"
          }}>
            <label style={{ fontWeight: "bold", color: "var(--primary)" }}>Focus Mode (Screen Only):</label>
            <div style={{ position: "relative" }}>
              <button 
                className="select-input"
                style={{ background: "white", cursor: "pointer", textAlign: "left", minWidth: "250px", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                onClick={() => setFocusDropdownOpen(!focusDropdownOpen)}
              >
                {focusedSubjectIndices.length === 0 ? "Show All Subjects" : `${focusedSubjectIndices.length} Subject(s) Selected`}
                <span>▼</span>
              </button>
              {focusDropdownOpen && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "white", border: "1px solid #ccc", borderRadius: "4px", marginTop: "4px", zIndex: 100, maxHeight: "250px", overflowY: "auto", boxShadow: "0 4px 6px rgba(0,0,0,0.1)", textAlign: "left" }}>
                  <div 
                    style={{ padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid #eee", background: "#f8f9fa", fontWeight: "bold", color: "black" }}
                    onClick={() => { setFocusedSubjectIndices([]); setFocusDropdownOpen(false); }}
                  >
                    Show All Subjects
                  </div>
                  {(classData.subjects || []).map((sub, idx) => (
                    <label key={idx} style={{ display: "flex", alignItems: "center", padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid #eee", color: "black", margin: 0 }}>
                      <input 
                        type="checkbox" 
                        checked={focusedSubjectIndices.includes(idx)} 
                        onChange={() => toggleSubjectFocus(idx)} 
                        style={{ marginRight: "10px", width: "16px", height: "16px" }}
                      />
                      <span style={{ fontSize: "12px" }}>{getCourseDetails()[idx]?.courseName || sub} ({getCourseDetails()[idx]?.courseCode || sub})</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          <style>{`
              @media print {
                @page { 
                  margin: 0.5cm;
                  margin-top: 0cm; 
                  margin-bottom: 1cm;
                  @bottom-center {
                    content: "Page " counter(page) " of " counter(pages);
                    font-size: 10px;
                    font-family: "Times New Roman", Times, serif;
                    color: black;
                  }
                }
                body { 
                  margin: 0 !important;
                  padding: 0 !important;
                }
                .no-print, .filter-row, .print-btn, h1, .lock-banner {
                  display: none !important;
                }
                .page-layout, .faculty-mark-entry-container, .print-no-margin {
                  padding: 0 !important;
                  margin: 0 !important;
                  border: none !important;
                  background: none !important;
                  background-image: none !important;
                  box-shadow: none !important;
                  color: black !important;
                }
                .printable-area { 
                  display: block !important;
                  width: 100% !important;
                  padding: 0 !important;
                  margin: 0 !important;
                }
                .print-bold-text, .print-bold-text th, .print-bold-text td, .print-bold-text span, .print-bold-text div, .print-bold-text p, .print-bold-text h3 {
                  font-weight: bold !important;
                }
                input { border: none !important; outline: none !important; }
                h1, h2, h3, p { margin: 2px 0 !important; padding: 0 !important; }
                table { border-collapse: collapse !important; width: 100% !important; margin: 5px 0 !important; }
                td, th { 
                  padding: 2px 4px !important; 
                  font-size: 12px !important; 
                  width: auto !important; 
                  min-width: 0 !important; 
                  max-width: none !important; 
                }
                .sticky-col-header, .sticky-col-body {
                  position: static !important;
                  left: auto !important;
                }
                .mark-input {
                  padding: 0 !important;
                  margin: 0 !important;
                }
                .sig-cell { height: 75px !important; }
                .focus-hidden { display: none !important; }
              }
              @media screen {
                .focus-hidden { display: none !important; }
                .faculty-screen-large {
                  font-size: 20px !important;
                }
                .faculty-screen-large th, .faculty-screen-large td {
                  padding: 10px 8px !important;
                  font-size: 18px !important;
                }
                .faculty-screen-large .mark-input {
                  font-size: 20px !important;
                  padding: 6px !important;
                  font-weight: bold;
                }
              }

              @keyframes toastFadeIn {
                from { opacity: 0; transform: translate(-50%, -40%); }
                to { opacity: 1; transform: translate(-50%, -50%); }
              }
              @keyframes toastSpin {
                100% { transform: rotate(360deg); }
              }

              .mark-input {
                width: 90%;
                text-align: center;
                border: 1px solid transparent;
                background: transparent;
                outline: none;
                color: inherit;
                font-family: inherit;
                font-size: inherit;
              }
              .mark-input:focus, .mark-input:hover {
                border: 1px solid #007bff;
                background: #f8f9fa;
              }
            `}
          </style>

          <button
            className="print-btn"
            onClick={() => window.print()}
            style={{ marginBottom: "20px", marginRight: "10px", padding: "10px 20px", background: "#007bff", color: "white", cursor: "pointer", border: "none", borderRadius: "4px" }}
          >
            Print
          </button>

          <label className="print-btn" style={{ display: "inline-flex", alignItems: "center", gap: "5px", cursor: "pointer", fontWeight: "bold", marginRight: "10px", marginBottom: "20px" }}>
            <input type="checkbox" checked={printBold} onChange={(e) => setPrintBold(e.target.checked)} style={{ width: "16px", height: "16px" }} />
            Print in Bold
          </label>

          <button
            className="print-btn"
            onClick={handleExportExcel}
            style={{ marginBottom: "20px", marginRight: "10px", padding: "10px 20px", background: "#28a745", color: "white", cursor: "pointer", border: "none", borderRadius: "4px" }}
          >
            Download Excel
          </button>

          {( (sessionStorage.getItem("role") || "").toLowerCase() === "admin" ) && (
            <label
              className="print-btn"
              style={{ marginBottom: "20px", marginRight: "10px", padding: "10px 20px", background: "#f59e0b", color: "white", cursor: "pointer", border: "none", borderRadius: "4px", display: "inline-block" }}
            >
              Upload Grades (Excel)
              <input type="file" accept=".xlsx, .xls" style={{ display: "none" }} onChange={handleExcelUpload} />
            </label>
          )}

          <button
            className="no-print"
            onClick={handleSave}
            disabled={(!isAdmin && (classData.allowEditing === false || isEditingLockedByDate().locked || !printEditAccess)) || isSaving}
            style={{
              padding: "10px 30px",
              background: (((!isAdmin && (classData.allowEditing === false || isEditingLockedByDate().locked || !printEditAccess)) || isSaving)) ? "#9ca3af" : "#4CAF50", 
              color: "white", 
              border: "none", 
              cursor: (((!isAdmin && (classData.allowEditing === false || isEditingLockedByDate().locked || !printEditAccess)) || isSaving)) ? "not-allowed" : "pointer", 
              borderRadius: "8px", 
              opacity: (((!isAdmin && (classData.allowEditing === false || isEditingLockedByDate().locked || !printEditAccess)) || isSaving)) ? 0.7 : 1,
              boxShadow: "0 4px 6px rgba(0,0,0,0.1)",
              fontWeight: "bold",
              fontSize: "16px"
            }}
          >
            {!isAdmin && classData.allowEditing === false ? "🔒 Entry Locked" : (!isAdmin && !printEditAccess) ? "🔒 Read-only" : (!isAdmin && isEditingLockedByDate().locked) ? "🔒 Entry Expired/Not Started" : isSaving ? "Saving..." : "Save Marks"}
          </button>

          <span className="no-print" style={{ marginLeft: "15px", fontSize: "14px", fontWeight: "bold", display: "inline-block", verticalAlign: "top", marginTop: "10px", marginBottom: "20px" }}>
            {unsavedChanges && <span style={{ color: "#f59e0b" }}>⚠️ Unsaved changes (auto-saving soon...)</span>}
            {!unsavedChanges && lastAutoSave && <span style={{ color: "#10b981" }}>✓ Auto-saved at {lastAutoSave.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}</span>}
          </span>

          <div className={`printable-area ${printBold ? 'print-bold-text' : ''}`} style={{ background: "white", color: "black", padding: "30px", fontFamily: '"Times New Roman", Times, serif', minWidth: "800px" }}>




            <div style={{ marginBottom: "10px", width: "100%" }}>
              <div style={{ textAlign: "right", fontSize: "12px", fontWeight: "bold", color: "black", marginBottom: "2px" }}>
                {classData.iqacPrefix || "MEC/IQAC/2026-27/COE/"}001
              </div>
              <img src={headerLogo} alt="MEC Header" style={{ width: "100%", height: "85px", display: "block" }} />

              <div style={{ textAlign: "center", marginTop: "8px" }}>
                <h2 style={{ margin: "5px 0 2px", fontSize: "14px", color: "black", fontWeight: "bold" }}>OFFICE OF THE CONTROLLER OF EXAMINATIONS</h2>
                <h3 style={{ margin: "0", fontSize: "14px", textTransform: "uppercase", color: "black" }}>{classData.examName === "ESE" ? "End Semester Examination" : classData.examName} MARK STATEMENT{classData.academicYearText || ""}</h3>
              </div>
            </div>




            {/* Info Row */}
            <div style={{ display: "flex", justifyContent: "space-between", margin: "10px 0", fontSize: "14px", fontWeight: "bold", color: "black" }}>
              <div>Prgm./Dept.: {classData.programme || "B.E"}/{classData.department || "CSE"}</div>
              <div>Year/Sem./Sec.: {classData.yearSemSec || "II/IV/A"}</div>
              <div>Date: {getDisplayDate()}</div>
            </div>





            <div className="table-responsive-wrapper">
              <table className={!isAdmin ? "faculty-screen-large" : ""} border="1" style={{ width: focusedSubjectIndices.length > 0 ? "auto" : "100%", borderCollapse: "collapse", textAlign: "center", fontSize: "12px", color: "black", borderColor: "black", minWidth: focusedSubjectIndices.length > 0 ? "auto" : "800px", margin: focusedSubjectIndices.length > 0 ? "0" : "5px 0" }}>





              <thead>
                <tr style={{ background: "#f2f2f2", fontSize: "12px" }}>
                  <th className="sticky-col-header" rowSpan="2" style={{ padding: "3px", left: 0, minWidth: "40px", width: "40px", maxWidth: "40px" }}>S.No.</th>
                  <th className="sticky-col-header" rowSpan="2" style={{ padding: "3px", left: "40px", minWidth: "100px", width: "100px", maxWidth: "100px" }}>Register<br />Number</th>
                  <th className="sticky-col-header" rowSpan="2" style={{ padding: "3px", left: "140px", minWidth: "160px", width: "160px", maxWidth: "160px", textAlign: "left", paddingLeft: "10px" }}>Name of the<br />Student</th>
                  {(classData.subjects || []).map((sub, idx) => (
                    <th key={idx} className={focusedSubjectIndices.length > 0 && !focusedSubjectIndices.includes(idx) ? "focus-hidden" : ""} style={{ padding: "2px", maxWidth: "80px", wordWrap: "break-word", fontSize: "10px" }}>
                      {getCourseDetails()[idx]?.courseCode || sub}
                    </th>
                  ))}
                  <th rowSpan="2" style={{ padding: "3px" }}>{classData.examName === "ESE" ? "SGPA" : <>Total<br />Marks</>}</th>
                  <th rowSpan="2" style={{ padding: "3px" }}>Pass %</th>
                  <th rowSpan="2" style={{ padding: "3px" }}>Pass/<br />Fail</th>
                </tr>

                <tr style={{ background: "#f2f2f2", fontSize: "12px" }}>
                  {getCourseDetails().map((cd, idx) => (
                    <th key={`cn-${idx}`} className={focusedSubjectIndices.length > 0 && !focusedSubjectIndices.includes(idx) ? "focus-hidden" : ""} style={{ padding: "4px", maxWidth: "80px", wordWrap: "break-word", fontSize: "10px", fontWeight: "bold", color: "black" }}>
                      {cd.shortName || cd.courseName}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(classData.students || []).map((s, i) => {
                  const focusedStats = getStudentFocusedStats(s);
                  return (
                  <tr key={s._id || i}>
                    <td className="sticky-col-body" style={{ padding: "4px", left: 0, minWidth: "40px", width: "40px", maxWidth: "40px" }}>{i + 1}</td>
                    <td className="sticky-col-body" style={{ padding: "4px", left: "40px", minWidth: "100px", width: "100px", maxWidth: "100px" }}>{s.regNo}</td>
                    <td className="sticky-col-body" style={{ padding: "4px", textAlign: "left", paddingLeft: "10px", fontSize: "12px", left: "140px", minWidth: "160px", width: "160px", maxWidth: "160px" }}>{s.name}</td>
                    {(classData.subjects || []).map((sub, j) => (
                      <td
                        key={j}
                        className={focusedSubjectIndices.length > 0 && !focusedSubjectIndices.includes(j) ? "focus-hidden" : ""}
                        style={{
                          padding: "0",
                          backgroundColor: (s.marks && (classData.examName === "ESE" ? (s.marks[j] === "AB" || s.marks[j] === "U" || s.marks[j] === "U*" || s.marks[j] === "FAIL") : (s.marks[j] === "AB" || s.marks[j] === "A" || (s.marks[j] !== "" && !isNaN(Number(s.marks[j])) && Number(s.marks[j]) < classData.passMark))))
                            ? "rgba(239, 68, 68, 0.45)"
                            : (s.marks && (s.marks[j] === "" || s.marks[j] === undefined || s.marks[j] === null) ? "#ffea00" : "transparent"),
                          WebkitPrintColorAdjust: "exact",
                          printColorAdjust: "exact"
                        }}
                      >
                        <LocalMarkInput
                          s={s}
                          j={j}
                          classData={classData}
                          printEditAccess={printEditAccess}
                          isEditingLockedByDate={isEditingLockedByDate}
                          handleMarkChange={handleMarkChange}
                          handleKeyDown={handleKeyDown}
                          i={i}
                          inputRef={(el) => inputRefs.current[`${i}_${j}`] = el}
                          isAdmin={isAdmin}
                        />
                      </td>
                    ))}
                    <td style={{ padding: "4px", fontWeight: "bold" }}>{focusedStats.total}</td>
                    <td style={{ padding: "4px" }}>{focusedStats.percentage}</td>
                    <td style={{ padding: "4px", fontWeight: "bold" }}>
                      {focusedStats.result === "Fail" ? "F" : focusedStats.result === "Pass" ? "P" : "-"}
                    </td>
                  </tr>
                )})}




                {/* Summary rows restored */}
                <tr style={{ fontWeight: "bold", background: "#f2f2f2" }}>
                  <td colSpan="3" className="sticky-col-body" style={{ textAlign: "right", padding: "4px", left: 0 }}>Total</td>
                  {(classData.subjects || []).map((_, idx) => (
                    <td key={`total-${idx}`} className={focusedSubjectIndices.length > 0 && !focusedSubjectIndices.includes(idx) ? "focus-hidden" : ""} style={{ padding: "4px" }}>{calculateSubjectStats(idx).total}</td>
                  ))}
                  <td colSpan="3"></td>
                </tr>
                <tr style={{ fontWeight: "bold", background: "#f2f2f2" }}>
                  <td colSpan="3" className="sticky-col-body" style={{ textAlign: "right", padding: "4px", left: 0 }}>Pass</td>
                  {(classData.subjects || []).map((_, idx) => (
                    <td key={`pass-${idx}`} className={focusedSubjectIndices.length > 0 && !focusedSubjectIndices.includes(idx) ? "focus-hidden" : ""} style={{ padding: "4px" }}>{calculateSubjectStats(idx).pass}</td>
                  ))}
                  <td colSpan="3"></td>
                </tr>
                <tr style={{ fontWeight: "bold", background: "#f2f2f2" }}>
                  <td colSpan="3" className="sticky-col-body" style={{ textAlign: "right", padding: "4px", left: 0 }}>Fail</td>
                  {(classData.subjects || []).map((_, idx) => (
                    <td key={`fail-${idx}`} className={focusedSubjectIndices.length > 0 && !focusedSubjectIndices.includes(idx) ? "focus-hidden" : ""} style={{ padding: "4px" }}>{calculateSubjectStats(idx).fail}</td>
                  ))}
                  <td colSpan="3"></td>
                </tr>
                <tr style={{ fontWeight: "bold", background: "#f2f2f2" }}>
                  <td colSpan="3" className="sticky-col-body" style={{ textAlign: "right", padding: "4px", left: 0 }}>Pass %</td>
                  {(classData.subjects || []).map((_, idx) => (
                    <td key={`passpct-${idx}`} className={focusedSubjectIndices.length > 0 && !focusedSubjectIndices.includes(idx) ? "focus-hidden" : ""} style={{ padding: "4px" }}>{calculateSubjectStats(idx).passPercent}</td>
                  ))}
                  <td colSpan="3"></td>
                </tr>
              </tbody>
            </table>
            </div>

            {/* Summary Text */}
            <div style={{ textAlign: "left", marginTop: "15px", color: "black" }}>
              <p style={{ margin: "5px 0", fontSize: "16px", fontWeight: "bold" }}>PASS % : TARGET : {classData.targetPassPercentage || 85} %</p>
              <p style={{ margin: "5px 0", fontSize: "16px", fontWeight: "bold" }}>Over all Pass %: (No. of students Pass = {classData?.students?.filter(s => getStudentFocusedStats(s).result === 'Pass').length || 0} /Total No. of students = {classData?.students?.length || 0})*100 = <span style={{ fontSize: "18px" }}>{getOverallPassPercent()} %</span></p>
            </div>





            {/* Faculty Table */}
            {focusedSubjectIndices.length === 1 ? (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", border: "1px solid black", padding: "10px", marginTop: "15px", fontWeight: "bold", fontSize: "14px", color: "black" }}>
                <div>COURSE CODE: {getCourseDetails()[focusedSubjectIndices[0]].courseCode}</div>
                <div>COURSE NAME: {getCourseDetails()[focusedSubjectIndices[0]].courseName}</div>
                <div>FACULTY: {getCourseDetails()[focusedSubjectIndices[0]].facultyName}</div>
                <div>SIGNATURE: ___________________</div>
              </div>
            ) : (
              <table border="1" style={{ width: "100%", borderCollapse: "collapse", marginTop: "10px", textAlign: "center", fontSize: "14px", fontWeight: "bold", borderColor: "black", color: "black" }}>
                <thead>
                  <tr style={{ background: "#f2f2f2", fontSize: "14px" }}>
                    <th style={{ padding: "6px" }}>S.No.</th>
                    <th style={{ padding: "6px" }}>COURSE CODE</th>
                    <th style={{ padding: "6px" }}>COURSE NAME</th>
                    <th style={{ padding: "6px" }}>NAME OF THE FACULTY</th>
                    <th style={{ padding: "6px" }}>PASS %</th>
                    <th style={{ padding: "6px" }}>SIGNATURE</th>
                  </tr>
                </thead>
                <tbody>
                  {getCourseDetails()
                    .map((c, i) => ({ c, originalIndex: i }))
                    .filter(({ originalIndex }) => focusedSubjectIndices.length === 0 || focusedSubjectIndices.includes(originalIndex))
                    .map(({ c, originalIndex }, displayIndex) => (
                    <tr key={originalIndex}>
                      <td style={{ padding: "4px" }}>{displayIndex + 1}</td>
                      <td style={{ padding: "4px" }}>{c.courseCode}</td>
                      <td style={{ padding: "4px", textAlign: "left", paddingLeft: "10px" }}>{c.courseName}</td>
                      <td style={{ padding: "4px", textAlign: "left", paddingLeft: "10px" }}>{c.facultyName}</td>
                      <td style={{ padding: "4px" }}>{calculateSubjectStats(originalIndex).passPercent}</td>
                      <td style={{ padding: "4px", minWidth: "100px" }}></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}





            {/* Signatures in bordered table */}
            <table border="1" style={{ width: "100%", borderCollapse: "collapse", marginTop: "15px", textAlign: "center", fontWeight: "bold", fontSize: "14px", color: "black", borderColor: "black" }}>
              <tbody>
                <tr>
                  <td className="sig-cell" style={{ padding: "5px", border: "1px solid black", height: "110px", verticalAlign: "bottom", fontWeight: "bold" }}>
                    Exam Coordinator<br />(Mentor 2)
                  </td>
                  <td className="sig-cell" style={{ padding: "5px", border: "1px solid black", height: "110px", verticalAlign: "bottom", fontWeight: "bold" }}>
                    Class Advisor<br />(Mentor 1)
                  </td>
                  <td className="sig-cell" style={{ padding: "5px", border: "1px solid black", height: "110px", verticalAlign: "bottom", fontWeight: "bold" }}>
                    Year Coordinator
                  </td>
                </tr>
                <tr>
                  <td className="sig-cell" style={{ padding: "5px", border: "1px solid black", height: "110px", verticalAlign: "bottom", fontWeight: "bold" }}>
                    HOD
                  </td>
                  <td className="sig-cell" style={{ padding: "5px", border: "1px solid black", height: "110px", verticalAlign: "bottom", fontWeight: "bold" }}>
                    COE
                  </td>
                  <td className="sig-cell" style={{ padding: "5px", border: "1px solid black", height: "110px", verticalAlign: "bottom", fontWeight: "bold" }}>
                    PRINCIPAL
                  </td>
                </tr>
              </tbody>
            </table>




            <p style={{ textAlign: "left", fontSize: "12px", marginTop: "15px", fontStyle: "normal", color: "black", fontFamily: '"Times New Roman", Times, serif' }}>
              NOTE : Last date for submission: Three (3) working days from the last exam.
            </p>


          </div>
        </div>
        </>
      )}
      {/* Watermark - Fixed at bottom corner, hidden in print */}
      <div className="no-print" style={{
        position: "fixed",
        bottom: "18px",
        right: "25px",
        opacity: 0.95,
        fontSize: "13px",
        color: "#2563eb",
        pointerEvents: "none",
        zIndex: 9999,
        fontWeight: "800",
        letterSpacing: "0.8px",
        fontFamily: "var(--font-body)",
        textShadow: "1px 1px 2px rgba(0,0,0,0.1)",
        background: "rgba(255,255,255,0.85)",
        padding: "4px 12px",
        borderRadius: "4px",
        border: "1px solid rgba(37, 99, 235, 0.2)"
      }}>
        DEVELOPED BY P BOOPATHI, TA/CSE
      </div>
    </div>
  );
}
