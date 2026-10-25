import mongoose from "mongoose";
import { contentConnection } from "../db.js";

// One quarterly SRIST Newsletter edition.
//
// Everything the public /newsletter page shows comes from this document, so a
// new edition is added from the admin editor (/newsletter-editor) — no change
// to the frontend code is needed. The PDF lives in its own collection
// (NewsletterPdf) so list/detail queries stay small.

// A single news item. The same shape is reused by every list below so the
// page can render any section with one component.
const ItemSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    text: { type: String, default: "", trim: true, maxlength: 3000 },
    // Free label: "Academic", "Placement", "Workshop"... (shown as a kicker)
    category: { type: String, default: "", trim: true, maxlength: 60 },
    // Department code/slug (cse, etce, me, ee, ce...) — used by Department News.
    department: { type: String, default: "", trim: true, maxlength: 40 },
    // Display date as typed ("12 Nov 2026"); upcoming events use it as the date.
    date: { type: String, default: "", trim: true, maxlength: 60 },
    venue: { type: String, default: "", trim: true, maxlength: 120 },
    // Optional photo — small optimised data URL (or a normal URL/path).
    image: { type: String, default: "" }
  },
  { _id: false }
);

const NewsletterSchema = new mongoose.Schema(
  {
    title: { type: String, default: "SRIST Newsletter", trim: true, maxlength: 160 },
    quarter: { type: Number, required: true, min: 1, max: 4 },
    year: { type: Number, required: true, min: 2000, max: 2100 },
    publicationDate: { type: Date, default: Date.now },
    description: { type: String, default: "", trim: true, maxlength: 600 }, // archive card blurb
    coverImage: { type: String, default: "" }, // archive thumbnail + cover photo fallback

    // Welcome note from the Principal / HOD shown under the masthead.
    editorial: {
      message: { type: String, default: "", trim: true, maxlength: 2500 },
      author: { type: String, default: "", trim: true, maxlength: 120 },
      role: { type: String, default: "", trim: true, maxlength: 120 }
    },

    // The cover story.
    featuredStory: {
      headline: { type: String, default: "", trim: true, maxlength: 200 },
      summary: { type: String, default: "", trim: true, maxlength: 600 },
      body: { type: String, default: "", trim: true, maxlength: 8000 },
      image: { type: String, default: "" },
      imageCaption: { type: String, default: "", trim: true, maxlength: 200 }
    },

    achievements: { type: [ItemSchema], default: [] }, // college-wide achievements ("In Brief")
    events: { type: [ItemSchema], default: [] }, // campus events & activities
    departmentHighlights: { type: [ItemSchema], default: [] },
    studentAchievements: { type: [ItemSchema], default: [] },
    facultyAchievements: { type: [ItemSchema], default: [] },
    researchHighlights: { type: [ItemSchema], default: [] },
    placementHighlights: { type: [ItemSchema], default: [] },
    upcomingEvents: { type: [ItemSchema], default: [] },

    // PDF metadata only — the bytes are in NewsletterPdf.
    pdf: {
      fileName: { type: String, default: "" },
      fileSize: { type: Number, default: 0 }
    },

    status: { type: String, enum: ["draft", "published"], default: "draft" }
  },
  { timestamps: true }
);

// One edition per quarter.
NewsletterSchema.index({ year: 1, quarter: 1 }, { unique: true });

export default contentConnection.model("Newsletter", NewsletterSchema);
