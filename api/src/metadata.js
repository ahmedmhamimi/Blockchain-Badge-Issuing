// =============================================================================
// metadata.js — Badge metadata generation (OpenSea-compatible format)
// =============================================================================

/**
 * Maps badge category to a color hex for the image seed.
 * DiceBear Shapes uses the seed to generate a deterministic SVG.
 */
const CATEGORY_COLORS = {
  "Blockchain":    "7F77DD",
  "Web Dev":       "1D9E75",
  "Security":      "D85A30",
  "Data Science":  "BA7517"
};

/**
 * Generates a metadata JSON object for a badge token.
 * Follows the OpenSea metadata standard so the structure is industry-standard.
 *
 * @param {number|string} tokenId
 * @param {object} badge - The BadgeData struct fields from the contract
 * @returns {object} metadata JSON
 */
function generateMetadata(tokenId, badge) {
  const issuedISO = new Date(Number(badge.issuedAt) * 1000).toISOString();
  const color     = CATEGORY_COLORS[badge.category] || "888888";

  // DiceBear Shapes: free public SVG avatar API, no API key, deterministic per seed
  const imageUrl = `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(badge.category)}-${tokenId}&backgroundColor=${color}&size=200`;

  return {
    name:         `Course Badge #${tokenId}: ${badge.courseName}`,
    description:  `Awarded to ${badge.studentName} for completing ${badge.courseName}. Grade: ${badge.grade}. This is a soul-bound achievement token — it cannot be transferred.`,
    image:        imageUrl,
    external_url: "http://localhost:8080",
    attributes: [
      { trait_type: "Course",     value: badge.courseName   },
      { trait_type: "Category",   value: badge.category     },
      { trait_type: "Grade",      value: badge.grade        },
      { trait_type: "Student",    value: badge.studentName  },
      { trait_type: "Token ID",   value: String(tokenId)    },
      { trait_type: "Issued",     value: issuedISO          },
      { trait_type: "Recipient",  value: badge.recipient    },
      { trait_type: "Soul-bound", value: "true"             }
    ]
  };
}

module.exports = { generateMetadata };
