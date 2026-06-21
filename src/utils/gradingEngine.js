/**
 * Grading Engine and Positioning Calculations
 */

/**
 * Returns the grade based on total score (CA + Exam)
 * @param {number} score 
 * @returns {string} Grade (A1, B2, etc.)
 */
function calculateGrade(score) {
  const numericScore = parseFloat(score);
  if (isNaN(numericScore)) return 'F9';

  if (numericScore >= 75) return 'A1';
  if (numericScore >= 70) return 'B2';
  if (numericScore >= 65) return 'B3';
  if (numericScore >= 60) return 'C4';
  if (numericScore >= 55) return 'C5';
  if (numericScore >= 50) return 'C6';
  if (numericScore >= 45) return 'D7';
  if (numericScore >= 40) return 'E8';
  return 'F9';
}

/**
 * Returns academic remark based on grade
 * @param {string} grade 
 * @returns {string} Remark (Excellent, Good, etc.)
 */
function calculateRemark(grade) {
  switch (grade) {
    case 'A1': return 'Excellent';
    case 'B2': return 'Very Good';
    case 'B3': return 'Good';
    case 'C4':
    case 'C5':
    case 'C6': return 'Credit';
    case 'D7':
    case 'E8': return 'Pass';
    case 'F9': return 'Fail';
    default: return 'No Grade';
  }
}

/**
 * Ranks a list of results and assigns a position string (e.g. "1st", "2nd", "3rd")
 * Handles ties by assigning the same rank to equal scores.
 * @param {Array} results Array of result objects containing { studentID, total }
 * @returns {Array} List of results containing a `position` string property
 */
function calculateClassPositions(results) {
  if (!Array.isArray(results) || results.length === 0) return [];

  // Sort by total score descending
  const sorted = [...results].sort((a, b) => parseFloat(b.total || 0) - parseFloat(a.total || 0));

  let currentRank = 1;
  let skipped = 0;

  return sorted.map((res, index, array) => {
    if (index > 0) {
      const prevTotal = parseFloat(array[index - 1].total || 0);
      const currTotal = parseFloat(res.total || 0);
      
      if (currTotal < prevTotal) {
        currentRank += 1 + skipped;
        skipped = 0;
      } else {
        skipped++;
      }
    }

    // Convert rank to suffix string (e.g. 1 -> 1st, 2 -> 2nd, 3 -> 3rd, 4 -> 4th, etc.)
    const suffix = getOrdinalSuffix(currentRank);
    
    return {
      ...res,
      position: currentRank
    };
  });
}

function getOrdinalSuffix(i) {
  const j = i % 10,
        k = i % 100;
  if (j === 1 && k !== 11) {
    return "st";
  }
  if (j === 2 && k !== 12) {
    return "nd";
  }
  if (j === 3 && k !== 13) {
    return "rd";
  }
  return "th";
}

module.exports = {
  calculateGrade,
  calculateRemark,
  calculateClassPositions
};
