import { useState, useEffect } from "react";
import { Routes, Route, Link, useLocation, useNavigate } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import AdminPanel from "./pages/AdminPanel";
import MarkEntry from "./pages/MarkEntry";
import ResultAnalysis from "./pages/ResultAnalysis";
import DepartmentAnalysis from "./pages/DepartmentAnalysis";
import InternalMarkSheet from "./pages/InternalMarkSheet";
import RankList from "./pages/RankList";
import AdminLogin from "./pages/AdminLogin";
import UserLogin from "./pages/UserLogin";
import UserRegister from "./pages/UserRegister";
import StudentLogin from "./pages/StudentLogin";
import StudentDashboard from "./pages/StudentDashboard";
import DailyAttendance from "./pages/DailyAttendance";
import StudentRequests from "./pages/StudentRequests";
import CorrectionRequests from "./pages/CorrectionRequests";
import StudentNotices from "./pages/StudentNotices";
import ParentLetter from "./pages/ParentLetter";
import AttendanceEntry from "./pages/AttendanceEntry";
import API from "./api";
import { LayoutDashboard, Settings, FileEdit, BarChart, Trophy, LogOut, MessageSquareWarning, Menu, X, Bell, Calendar } from "lucide-react";
import './App.css';
import ErrorBoundary from "./ErrorBoundary";

const blinkAnimation = `
@keyframes pulseBlink {
  0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
  50% { transform: scale(1.15); box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
  100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
}
.badge-blink {
  animation: pulseBlink 1.5s infinite;
}
.colorful-watermark {
  position: fixed;
  bottom: 25px;
  right: 30px;
  font-size: 11px;
  font-weight: 800;
  pointer-events: none;
  z-index: 9999;
  user-select: none;
  letter-spacing: 1.5px;
  background: linear-gradient(135deg, #7c3aed 0%, #4c1d95 100%);
  color: #ffffff;
  padding: 0.6rem 1.2rem;
  border-radius: 50px;
  box-shadow: 0 8px 24px rgba(124, 58, 237, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
}
`;

function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [authState, setAuthState] = useState("loading"); // loading, adminLogin, userLogin, studentLogin, register, admin, user, student
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    // If authState is loading, we just check session storage and set initial state
    if (authState === "loading") {
      try {
        const token = sessionStorage.getItem("token");
        const role = sessionStorage.getItem("role");
        const validRoles = ["admin", "printAdmin", "user", "student"];
        if (token && role && validRoles.includes(role)) {
          setAuthState(role);
        } else {
          setAuthState("studentLogin"); // Default to student portal
        }
      } catch (e) {
        // sessionStorage not available (e.g. Safari private mode)
        setAuthState("studentLogin");
      }
      return;
    }

    // Now start polling based on the current authState
    if (authState === "admin" || authState === "printAdmin") {
      if (authState === "admin") fetchPendingCount();
      
      const verifySession = async () => {
        try {
          await API.get('/api/auth/admin/verify-session', {
            headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` }
          });
        } catch (err) {
          if (err.response && err.response.status === 401) {
            handleLogout();
            alert("Session securely logged out because your account was signed in on another device.");
          }
        }
      };

      let inactivityTimer;
      const resetInactivityTimer = () => {
        clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => {
          handleLogout();
          alert("Session securely logged out due to 10 minutes of inactivity.");
        }, 10 * 60 * 1000); // 10 minutes
      };

      window.addEventListener('mousemove', resetInactivityTimer);
      window.addEventListener('keydown', resetInactivityTimer);
      window.addEventListener('click', resetInactivityTimer);
      window.addEventListener('scroll', resetInactivityTimer);
      resetInactivityTimer();
      
      try {
        if (authState === "admin" && "Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
          const promise = Notification.requestPermission();
          if (promise) {
            promise.catch(err => console.error("Notification permission error:", err));
          }
        }
      } catch (err) {
        console.error("Notification request failed", err);
      }
      
      const pendingInterval = authState === "admin" ? setInterval(fetchPendingCount, 15000) : null;
      const sessionInterval = setInterval(verifySession, 30000);
      
      return () => {
        if (pendingInterval) clearInterval(pendingInterval);
        clearInterval(sessionInterval);
        clearTimeout(inactivityTimer);
        window.removeEventListener('mousemove', resetInactivityTimer);
        window.removeEventListener('keydown', resetInactivityTimer);
        window.removeEventListener('click', resetInactivityTimer);
        window.removeEventListener('scroll', resetInactivityTimer);
      };
    } else if (authState === "student") {
      fetchStudentUnreadCount();
      subscribeStudentToPushNotifications();
      const interval = setInterval(fetchStudentUnreadCount, 15000);
      return () => clearInterval(interval);
    }
  }, [authState]);

  // Block mobile swipe-back / browser back — show logout confirmation
  useEffect(() => {
    const loggedInStates = ["admin", "printAdmin", "user", "student"];
    if (!loggedInStates.includes(authState)) return;

    // Push sentinel state so there is always a state to pop
    window.history.pushState({ appSentinel: true }, "");

    const handlePopState = (e) => {
      // Push forward immediately to prevent any navigation
      window.history.pushState({ appSentinel: true }, "");

      // Show confirmation — using setTimeout so the pushState settles first
      setTimeout(() => {
        const confirmed = window.confirm("Do you want to logout?");
        if (confirmed) {
          handleLogout();
        }
        // If NO — we already pushed forward, so user stays in app
      }, 50);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [authState]);

  const urlBase64ToUint8Array = (base64String) => {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  };

  const subscribeStudentToPushNotifications = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return;
    }
    
    try {
      // Register service worker
      const registration = await navigator.serviceWorker.register('/sw.js');
      
      // Request permission
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;

      // Get VAPID key from backend
      const vapidRes = await API.get('/api/announcements/vapid-public-key');
      const publicKey = vapidRes.data.publicKey;
      
      // Subscribe
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });

      // Send to backend
      const token = sessionStorage.getItem("token");
      if (token) {
        await API.post('/api/announcements/subscribe', { subscription }, {
          headers: { Authorization: `Bearer ${token}` }
        });
      }
    } catch (err) {
      console.error("Failed to subscribe to push notifications:", err);
    }
  };

  const fetchPendingCount = async () => {
    try {
      const res = await API.get("/api/corrections/pending-count");
      setPendingRequestsCount(prev => {
        // Trigger push notification if count increased
        if (prev !== null && res.data.count > prev) {
          if ("Notification" in window && Notification.permission === "granted") {
            new Notification("New Correction Request", {
              body: "A student just submitted a new mark correction request.",
              icon: "/favicon.ico"
            });
          }
        }
        return res.data.count;
      });
    } catch (err) {
      console.error("Failed to fetch pending requests count");
    }
  };

  const fetchStudentUnreadCount = async () => {
    try {
      const regNo = sessionStorage.getItem("userId"); // The regNo is stored in userId
      if (!regNo) return;
      const res = await API.get(`/api/corrections/student/${regNo}/unread-count`);
      setPendingRequestsCount(res.data.count); // Reuse this state variable to show badge
    } catch (err) {
      console.error("Failed to fetch student unread count");
    }
  };

  const handleLogin = (state) => {
    if (state === "admin" || state === "printAdmin" || state === "user" || state === "student") {
      setAuthState(state);
      navigate("/");
    } else if (state === "showUserLogin") {
      setAuthState("userLogin");
    } else if (state === "showStudentLogin") {
      setAuthState("studentLogin");
    }
  };

  const handleSwitch = (target) => {
    if (target === "register") setAuthState("register");
    else if (target === "userLogin") setAuthState("userLogin");
    else if (target === "adminLogin") setAuthState("adminLogin");
    else if (target === "studentLogin") setAuthState("studentLogin");
  };

  const handleLogout = () => {
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("role");
    sessionStorage.removeItem("userName");
    sessionStorage.removeItem("userId");
    setAuthState("userLogin");
    navigate("/");
  };

  if (authState === "loading") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0b0f19", color: "#fff", gap: "16px" }}>
        <div style={{ width: "48px", height: "48px", border: "4px solid rgba(99,102,241,0.3)", borderTop: "4px solid #6366f1", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <span style={{ color: "#94a3b8", fontSize: "14px", fontWeight: 500 }}>Loading...</span>
      </div>
    );
  }

  const renderLoginWatermark = () => (
    <div className="login-watermark-mobile" style={{
      position: "fixed",
      bottom: "20px",
      left: "50%",
      transform: "translateX(-50%)",
      background: "rgba(15, 23, 42, 0.7)",
      backdropFilter: "blur(12px)",
      padding: "10px 24px",
      borderRadius: "50px",
      border: "1px solid rgba(99, 102, 241, 0.4)",
      color: "#e2e8f0",
      fontSize: "0.85rem",
      fontWeight: "600",
      letterSpacing: "1px",
      display: "flex",
      alignItems: "center",
      gap: "10px",
      boxShadow: "0 8px 25px rgba(0, 0, 0, 0.3), 0 0 15px rgba(99, 102, 241, 0.2)",
      zIndex: 9999,
      pointerEvents: "none",
      userSelect: "none",
      whiteSpace: "nowrap"
    }}>
      <span style={{ color: "#818cf8", fontSize: "1rem" }}>✨</span>
      Developed By <span style={{ color: "#c7d2fe", fontWeight: "800", textShadow: "0 0 10px rgba(199, 210, 254, 0.5)" }}>BOOPATHI P - CSE</span>
    </div>
  );

  if (authState === "adminLogin") {
    return <><AdminLogin onLogin={handleLogin} />{renderLoginWatermark()}</>;
  }
  if (authState === "userLogin") {
    return <><UserLogin onLogin={handleLogin} onSwitch={handleSwitch} />{renderLoginWatermark()}</>;
  }
  if (authState === "studentLogin") {
    return <><StudentLogin onLogin={handleLogin} onSwitch={handleSwitch} />{renderLoginWatermark()}</>;
  }
  if (authState === "register") {
    return <><UserRegister onSwitch={handleSwitch} />{renderLoginWatermark()}</>;
  }

  const isAdmin = authState === "admin";
  const isPrintAdmin = authState === "printAdmin";
  const isStudent = authState === "student";

  const adminNavItems = [
    { name: "Dashboard", path: "/", icon: <LayoutDashboard size={20} /> },
    { name: "Admin Panel", path: "/admin", icon: <Settings size={20} /> },
    { name: "Daily Attendance", path: "/daily-attendance", icon: <Calendar size={20} /> },
    { name: "Attendance Entry", path: "/attendance", icon: <FileEdit size={20} /> },
    { name: "Mark Statement", path: "/entry", icon: <FileEdit size={20} /> },
    { name: "Internal Marks", path: "/internal-mark", icon: <FileEdit size={20} /> },
    { name: "Class Analysis", path: "/analysis", icon: <BarChart size={20} /> },
    { name: "Dept. Analysis", path: "/department-analysis", icon: <BarChart size={20} /> },
    { name: "Rank List", path: "/rank", icon: <Trophy size={20} /> },
    { name: "Parent Letters", path: "/parent-letters", icon: <span style={{fontSize:"18px"}}>📬</span> },
    { 
      name: "Mark Requests", 
      path: "/requests", 
      icon: <MessageSquareWarning size={20} />,
      badge: pendingRequestsCount > 0 ? pendingRequestsCount : null
    },
  ];

  const printAdminNavItems = [
    { name: "Daily Attendance", path: "/daily-attendance", icon: <Calendar size={20} /> },
    { name: "Attendance Entry", path: "/attendance", icon: <FileEdit size={20} /> },
    { name: "Mark Statement", path: "/entry", icon: <FileEdit size={20} /> },
    { name: "Internal Marks", path: "/internal-mark", icon: <FileEdit size={20} /> },
    { name: "Class Analysis", path: "/analysis", icon: <BarChart size={20} /> },
    { name: "Dept. Analysis", path: "/department-analysis", icon: <BarChart size={20} /> },
    { name: "Rank List", path: "/rank", icon: <Trophy size={20} /> },
    { name: "Parent Letters", path: "/parent-letters", icon: <span style={{fontSize:"18px"}}>📬</span> },
    { 
      name: "Mark Requests", 
      path: "/requests", 
      icon: <MessageSquareWarning size={20} />,
      badge: pendingRequestsCount > 0 ? pendingRequestsCount : null
    },
  ];

  // Default pages always visible to all faculty
  const userNavItems = [
    { name: "Dashboard", path: "/", icon: <LayoutDashboard size={20} /> },
  ];

  // Extra pages the admin can allocate
  const ALLOCATABLE_DASHBOARD_PAGES = [
    { id: "daily-attendance", name: "Daily Attendance", path: "/daily-attendance", icon: <Calendar size={20} /> },
    { id: "attendance", name: "Attendance Entry", path: "/attendance", icon: <FileEdit size={20} /> },
    { id: "entry", name: "Mark Statement", path: "/entry", icon: <FileEdit size={20} /> },
    { id: "internal-mark", name: "Internal Marks", path: "/internal-mark", icon: <FileEdit size={20} /> },
    { id: "analysis", name: "Class Analysis", path: "/analysis", icon: <BarChart size={20} /> },
    { id: "department-analysis", name: "Dept. Analysis", path: "/department-analysis", icon: <BarChart size={20} /> },
    { id: "rank", name: "Rank List", path: "/rank", icon: <Trophy size={20} /> },
    { id: "parent-letters", name: "Parent Letters", path: "/parent-letters", icon: <span style={{fontSize:"18px"}}>📬</span> },
    { id: "requests", name: "Mark Requests", path: "/requests", icon: <MessageSquareWarning size={20} />, badge: pendingRequestsCount > 0 ? pendingRequestsCount : null },
  ];

  try {
    const dashboardTabs = JSON.parse(sessionStorage.getItem("dashboardTabs") || "[]");
    ALLOCATABLE_DASHBOARD_PAGES.forEach(page => {
      if (dashboardTabs.includes(page.id)) userNavItems.push(page);
    });
    const adminTabs = JSON.parse(sessionStorage.getItem("adminTabs") || "[]");
    if (adminTabs.length > 0) {
      userNavItems.push({ name: "Admin Setup", path: "/admin", icon: <Settings size={20} /> });
    }
  } catch(e) {}

  const studentNavItems = [
    { name: "My Results", path: "/", icon: <Trophy size={20} /> },
    { name: "Campus Notices", path: "/notices", icon: <Bell size={20} /> },
    { 
      name: "My Requests", 
      path: "/student-requests", 
      icon: <MessageSquareWarning size={20} />,
      badge: pendingRequestsCount > 0 ? pendingRequestsCount : null
    },
  ];

  const navItems = isAdmin ? adminNavItems : (isPrintAdmin ? printAdminNavItems : (isStudent ? studentNavItems : userNavItems));

  const showNav = authState !== "loading" && authState !== "adminLogin" && authState !== "userLogin" && authState !== "studentLogin" && authState !== "register";

  return (
    <div className="app-container">
      <style>{blinkAnimation}</style>
      
      {showNav && (
        <div className="mobile-top-bar no-print">
          <button className="menu-toggle-btn" onClick={() => setSidebarOpen(true)}>
            <Menu size={24} />
          </button>
          <span className="mobile-logo">Result Hub</span>
        </div>
      )}

      {showNav && sidebarOpen && (
        <div className="sidebar-overlay no-print" onClick={() => setSidebarOpen(false)}></div>
      )}

      <nav className={`sidebar no-print ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-header">
          <h2 className="logo">Result Hub</h2>
          <button className="sidebar-close-btn" onClick={() => setSidebarOpen(false)}>
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: "0 1.5rem", marginBottom: "1.5rem" }}>
          <div style={{
            padding: "1rem",
            borderRadius: "1rem",
            background: "rgba(99,102,241,0.08)",
            border: "1px solid rgba(99,102,241,0.15)",
            backdropFilter: "blur(4px)"
          }}>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.25rem" }}>Logged in as</div>
            <div style={{ color: "var(--primary)", fontWeight: "700", fontSize: "0.95rem" }}>{isAdmin ? "Administrator" : (isPrintAdmin ? "Print Admin" : (isStudent ? (sessionStorage.getItem("userName") || "Student") : (sessionStorage.getItem("userName") || "Faculty")))}</div>
          </div>
        </div>

        <ul>
          {navItems.map((item) => (
            <li key={item.path} className={location.pathname === item.path ? "active" : ""}>
              <Link to={item.path} onClick={() => setSidebarOpen(false)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  {item.icon}
                  <span>{item.name}</span>
                </div>
                {item.badge && (
                  <span style={{
                    background: "var(--danger)",
                    color: "white",
                    fontSize: "0.75rem",
                    fontWeight: "bold",
                    padding: "2px 6px",
                    borderRadius: "10px",
                    marginLeft: "auto"
                  }} className="badge-blink">
                    {item.badge}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>

        <div style={{ padding: "1.5rem", borderTop: "1px solid var(--border-color)", marginTop: "auto" }}>
          <a href="#" className="nav-link" onClick={(e) => { e.preventDefault(); setSidebarOpen(false); handleLogout(); }} style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            color: "var(--danger)",
            fontWeight: "600",
            textDecoration: "none",
            fontSize: "0.95rem"
          }}>
            <LogOut size={20} />
            <span>Sign Out</span>
          </a>
        </div>
      </nav>

      <main className="main-content">
        <div className="page-layout">
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={isPrintAdmin ? <MarkEntry /> : (isStudent ? <StudentDashboard /> : <Dashboard />)} />
              <Route path="/admin" element={<AdminPanel />} />
              <Route path="/daily-attendance" element={isStudent ? <StudentDashboard /> : <DailyAttendance />} />
              <Route path="/attendance" element={isStudent ? <StudentDashboard /> : <AttendanceEntry />} />
              <Route path="/entry" element={isStudent ? <StudentDashboard /> : <MarkEntry />} />
              <Route path="/internal-mark" element={isStudent ? <StudentDashboard /> : <InternalMarkSheet />} />
              {(isAdmin || isPrintAdmin) && <Route path="/analysis" element={<ResultAnalysis />} />}
              {(isAdmin || isPrintAdmin) && <Route path="/department-analysis" element={<DepartmentAnalysis />} />}
              {(isAdmin || isPrintAdmin) && <Route path="/rank" element={<RankList />} />}
              {(isAdmin || isPrintAdmin) && <Route path="/parent-letters" element={<ParentLetter />} />}
              {(isAdmin || isPrintAdmin) && <Route path="/requests" element={<CorrectionRequests />} />}
              {/* Faculty (user) routes for allocated dashboard pages */}
              {(!isAdmin && !isPrintAdmin && !isStudent) && <Route path="/internal-mark" element={<InternalMarkSheet />} />}
              {(!isAdmin && !isPrintAdmin && !isStudent) && <Route path="/analysis" element={<ResultAnalysis />} />}
              {(!isAdmin && !isPrintAdmin && !isStudent) && <Route path="/department-analysis" element={<DepartmentAnalysis />} />}
              {(!isAdmin && !isPrintAdmin && !isStudent) && <Route path="/rank" element={<RankList />} />}
              {(!isAdmin && !isPrintAdmin && !isStudent) && <Route path="/parent-letters" element={<ParentLetter />} />}
              {(!isAdmin && !isPrintAdmin && !isStudent) && <Route path="/requests" element={<CorrectionRequests />} />}
              {isStudent && <Route path="/student-requests" element={<StudentRequests />} />}
              {isStudent && <Route path="/notices" element={<StudentNotices />} />}
            </Routes>
          </ErrorBoundary>
        </div>
      </main>
      {isStudent && (
        <div className="no-print colorful-watermark">
          ✨ DEVELOPED BY P.BOOPATHI - CSE
        </div>
      )}
    </div>
  );
}

export default App;
