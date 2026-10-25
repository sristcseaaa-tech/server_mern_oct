// Run with: npm run seed
// Populates MongoDB with the starting content shown on the homepage.
import dotenv from "dotenv";
import { connectDatabases, contentConnection } from "./db.js";
import Stat from "./models/Stat.js";
import Course from "./models/Course.js";
import Recruiter from "./models/Recruiter.js";
import Content from "./models/Content.js";

dotenv.config();

const stats = [
  { label: "Campus Area", value: "3-Acre", color: "coral", order: 1 },
  { label: "Students", value: "1000+", color: "amber", order: 2 },
  { label: "Highest Package", value: "₹4 LPA", color: "teal", order: 3 },
  { label: "Job Offers", value: "300+", color: "violet", order: 4 },
  { label: "Recruiters", value: "70+", color: "green", order: 5 },
  { label: "Legacy", value: "16+ Yrs", color: "blue", order: 6 }
];

const courses = [
  { code: "CSE", name: "Diploma in CSE", duration: "3 Years", intake: 60, order: 5 },
  { code: "ME", name: "Diploma in ME", duration: "3 Years", intake: 60, order: 4 },
  { code: "ETCE", name: "Diploma in ETCE", duration: "3 Years", intake: 60, order: 1 },
  { code: "EE", name: "Diploma in EE", duration: "3 Years", intake: 60, order: 2 },
  { code: "CE", name: "Diploma in CE", duration: "3 Years", intake: 60, order: 3 }
];

const recruiters = [
  { name: "Wipro", logoUrl: "/assets/logos/wipro.png", row: 1 },
  { name: "Infosys", logoUrl: "/assets/logos/infosys.png", row: 1 },
  { name: "Oracle", logoUrl: "/assets/logos/oracle.png", row: 1 },
  { name: "IBM", logoUrl: "/assets/logos/ibm.png", row: 2 },
  { name: "HCL", logoUrl: "/assets/logos/hcl.png", row: 2 },
  { name: "Cognizant", logoUrl: "/assets/logos/cognizant.png", row: 2 },
  { name: "TCS", logoUrl: "/assets/logos/tcs.png", row: 3 },
  { name: "Accenture", logoUrl: "/assets/logos/accenture.png", row: 3 }
];

// Default editable homepage content, matching what's currently hardcoded
// in Hero.jsx — so the site looks unchanged until someone edits it in
// the /customize page.
const heroContent = [
  { section: "hero", key: "eyebrow", label: "Eyebrow text", type: "text", value: "SHREE RAMKRISHNA INSTITUTE OF SCIENCE & TECHNOLOGY" },
  { section: "hero", key: "titleLine1", label: "Title — line 1", type: "text", value: "Build. Test. Create." },
  { section: "hero", key: "titleLine2", label: "Title — line 2 (accent)", type: "text", value: "Innovation & Praxis." },
  { section: "hero", key: "lead", label: "Paragraph", type: "textarea", value: "Hands-on engineering education in advanced labs, smart classrooms and a placement cell that treats every student's outcome as the real scorecard — not just the prospectus." },
  { section: "hero", key: "backgroundImage", label: "Background image URL", type: "image", value: "/assets/campus-building.png" },
  { section: "hero", key: "accentColor", label: "Accent color", type: "color", value: "#E8573F" },
  {
    section: "hero",
    key: "weekNotes",
    label: "This week at SRIST — notes",
    type: "textarea",
    value: JSON.stringify([
      { text: "Robotics lab open house — Fri", color: "#E8573F" },
      { text: "Placement drive: 3 companies — Mon", color: "#1E9E8B" },
      { text: "Inter-college sports meet — Sat", color: "#7C5CBF" }
    ])
  }
];

// Site-wide dark/light mode, applied via data-theme on <html> (see
// client/src/context/ThemeContext.jsx).
const themeContent = [
  { section: "theme", key: "mode", label: "Site mode", type: "text", value: "light" }
];

// Default editable navbar content — logo image, "Apply Now" button text,
// and optional background/text color overrides (leave blank to use the
// theme default).
const navbarContent = [
  { section: "navbar", key: "logoImage", label: "Logo image (legacy, used if no light/dark logo is set)", type: "image", value: "/assets/srist-logo.png" },
  { section: "navbar", key: "logoImageLight", label: "Logo — light mode", type: "image", value: "/assets/srist-logo.png" },
  { section: "navbar", key: "logoImageDark", label: "Logo — dark mode", type: "image", value: "/assets/srist-logo.png" },
  { section: "navbar", key: "applyButtonText", label: "Apply button text", type: "text", value: "Apply Now" },
  { section: "navbar", key: "backgroundColor", label: "Background color (blank = default)", type: "color", value: "" },
  { section: "navbar", key: "textColor", label: "Text color (blank = default)", type: "color", value: "" }
];

// Site-wide brand palette — overrides the CSS variables every page (cards,
// buttons, dots, marquees) already uses, so one hex code here recolors the
// whole site instead of one section at a time.
const brandContent = [
  { section: "brand", key: "coral", label: "Primary accent (coral)", type: "color", value: "#E8573F" },
  { section: "brand", key: "amber", label: "Secondary accent (amber)", type: "color", value: "#E8A33D" },
  { section: "brand", key: "teal", label: "Accent (teal)", type: "color", value: "#1E9E8B" },
  { section: "brand", key: "violet", label: "Accent (violet)", type: "color", value: "#7C5CBF" },
  { section: "brand", key: "blue", label: "Accent (blue)", type: "color", value: "#2B4C7E" },
  { section: "brand", key: "green", label: "Accent (green)", type: "color", value: "#3F7D58" },
  { section: "brand", key: "ink", label: "Heading / text ink color", type: "color", value: "#16253D" }
];

// Default editable "Campus Life" section heading (CampusLife.jsx).
const campusLifeContent = [
  { section: "campuslife", key: "eyebrow", label: "Eyebrow text", type: "text", value: "CAMPUS LIFE" },
  { section: "campuslife", key: "title", label: "Heading", type: "text", value: "A day in the life at SRIST" },
  { section: "campuslife", key: "subtitle", label: "Subtitle", type: "textarea", value: "Labs, classrooms, the field, and the cafeteria — a real day on campus." }
];

// Default editable "Diploma Programmes" section heading (Courses.jsx).
// {count} in the title is replaced with the live course count.
const coursesContent = [
  { section: "courses", key: "eyebrow", label: "Eyebrow text", type: "text", value: "DIPLOMA PROGRAMMES" },
  { section: "courses", key: "title", label: "Heading (use {count} for the live course count)", type: "text", value: "{count} trades, one campus" },
  { section: "courses", key: "subtitle", label: "Subtitle", type: "textarea", value: "All programmes are AICTE-recognised, 3-year diploma courses with government-sanctioned fees." }
];

// Default editable "Recruiting Partners" section heading (Placement.jsx).
const placementContent = [
  { section: "placement", key: "eyebrow", label: "Eyebrow text", type: "text", value: "RECRUITING PARTNERS" },
  { section: "placement", key: "title", label: "Heading", type: "text", value: "Where SRIST graduates land" },
  { section: "placement", key: "subtitle", label: "Subtitle", type: "textarea", value: "70+ recruiters visit campus each year across core engineering, IT, and manufacturing." },
  { section: "placement", key: "row1Image", label: "Recruiter logo strip — row 1", type: "image", value: "/assets/logos/row1.png" },
  { section: "placement", key: "row2Image", label: "Recruiter logo strip — row 2", type: "image", value: "/assets/logos/row2.png" },
  { section: "placement", key: "row3Image", label: "Recruiter logo strip — row 3", type: "image", value: "/assets/logos/row3.png" }
];

// Default editable "Institute at a glance" section heading (About.jsx).
const glanceContent = [
  { section: "glance", key: "eyebrow", label: "Eyebrow text", type: "text", value: "INSTITUTE AT A GLANCE" },
  { section: "glance", key: "title", label: "Heading", type: "text", value: "SRIST, by the numbers" },
  { section: "glance", key: "subtitle", label: "Subtitle", type: "textarea", value: "Live figures pulled from the institute & placement cell records in MongoDB." }
];

// Default editable "About Us" section content (AboutUs.jsx).
const aboutContent = [
  { section: "about", key: "eyebrow", label: "Eyebrow text", type: "text", value: "THE BEST POLYTECHNIC COLLEGE IN KOLKATA" },
  { section: "about", key: "title", label: "Heading", type: "text", value: "About Us" },
  { section: "about", key: "paragraph1", label: "Paragraph 1", type: "textarea", value: "Shree Ramkrishna Institute of Science and Technology, aka SRIST, is one of the best Polytechnic colleges in Kolkata. SRIST offers Polytechnic Diploma courses in various trades like Electronics and Telecommunication Engineering (ETCE), Electrical Engineering (EE), Civil Engineering (CE), Mechanical Engineering (ME), and Computer Science & Engineering (CSE)." },
  { section: "about", key: "paragraph2", label: "Paragraph 2", type: "textarea", value: "SRIST, also known as Shree Ramkrishna Institute of Science and Technology, is a Polytechnic Diploma college under the Swami Vivekananda Group of Institutes (SVGI). SRIST is approved by AICTE, Govt. of India, and affiliated to WBSCTVESD, Govt. of West Bengal." }
];

// Default editable "Why SRIST" section content (Highlights.jsx), including
// each card's accent color.
const whyContent = [
  { section: "why", key: "eyebrow", label: "Eyebrow text", type: "text", value: "WHY SRIST" },
  { section: "why", key: "title", label: "Heading", type: "text", value: "What the diploma is built on" },
  { section: "why", key: "subtitle", label: "Subtitle", type: "textarea", value: "Three commitments that shape the classroom, the workshop floor, and the placement cell alike." },
  { section: "why", key: "card1Color", label: "Card 1 color (Skill Based Education)", type: "color", value: "#E8573F" },
  { section: "why", key: "card2Color", label: "Card 2 color (Industry Collaboration)", type: "color", value: "#1E9E8B" },
  { section: "why", key: "card3Color", label: "Card 3 color (Student Centric Approach)", type: "color", value: "#7C5CBF" }
];

// Default editable footer content (Footer.jsx).
const footerContent = [
  { section: "footer", key: "brandText", label: "Brand paragraph", type: "textarea", value: "Shree Ramkrishna Institute of Science and Technology — a AICTE-approved, WBSCTVESD-affiliated Polytechnic college in Kolkata, under the Swami Vivekananda Group of Institutes (SVGI)." },
  { section: "footer", key: "address", label: "Address (use \\n for line breaks)", type: "textarea", value: "Shree Ramkrishna Institute of Science and Technology,\nDakshin Gobindapur, Rajpur Sonarpur,\nKolkata, West Bengal 700145" },
  { section: "footer", key: "phone", label: "Phone", type: "text", value: "+91-XX-XXXX-XXXX" },
  { section: "footer", key: "email", label: "Email", type: "text", value: "info@srist.in" }
];

// Default gallery captions, no images yet — Gallery.jsx falls back to
// colored placeholder tiles until an image is uploaded for each slot from
// Customize → Gallery.
const galleryContent = [
  { section: "gallery", key: "item1Caption", label: "Item 1 caption", type: "text", value: "Annual Tech Fest" },
  { section: "gallery", key: "item1Image", label: "Item 1 image", type: "image", value: "" },
  { section: "gallery", key: "item2Caption", label: "Item 2 caption", type: "text", value: "Freshers' Welcome" },
  { section: "gallery", key: "item2Image", label: "Item 2 image", type: "image", value: "" },
  { section: "gallery", key: "item3Caption", label: "Item 3 caption", type: "text", value: "Industry Guest Lecture" },
  { section: "gallery", key: "item3Image", label: "Item 3 image", type: "image", value: "" },
  { section: "gallery", key: "item4Caption", label: "Item 4 caption", type: "text", value: "Sports Day" },
  { section: "gallery", key: "item4Image", label: "Item 4 image", type: "image", value: "" },
  { section: "gallery", key: "item5Caption", label: "Item 5 caption", type: "text", value: "Republic Day Celebration" },
  { section: "gallery", key: "item5Image", label: "Item 5 image", type: "image", value: "" },
  { section: "gallery", key: "item6Caption", label: "Item 6 caption", type: "text", value: "Placement Drive on Campus" },
  { section: "gallery", key: "item6Image", label: "Item 6 image", type: "image", value: "" }
];

async function run() {
  await connectDatabases();
  await Promise.all([Stat.deleteMany({}), Course.deleteMany({}), Recruiter.deleteMany({})]);
  await Stat.insertMany(stats);
  await Course.insertMany(courses);
  await Recruiter.insertMany(recruiters);

  // Content: upsert so re-running seed doesn't wipe out edits already made in the customizer.
  await Promise.all(
    [
      ...themeContent,
      ...heroContent,
      ...navbarContent,
      ...brandContent,
      ...aboutContent,
      ...whyContent,
      ...footerContent,
      ...galleryContent,
      ...campusLifeContent,
      ...coursesContent,
      ...placementContent,
      ...glanceContent
    ].map((f) =>
      Content.updateOne({ section: f.section, key: f.key }, { $setOnInsert: f }, { upsert: true })
    )
  );

  console.log("Seeded stats, courses, recruiters, and default content for every customizable section.");
  await contentConnection.close();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
