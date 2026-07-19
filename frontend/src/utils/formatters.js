/**
 * Formats phone number for display
 * Converts 10-digit number to format: +91 XXXXX XXXXX
 * 
 * @param {string} phone - Phone number (10 digits or with country code)
 * @returns {string} Formatted phone number
 */
export function formatPhoneDisplay(phone) {
  if (!phone) return '';
  
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');
  
  // If 10 digits (Indian number without country code)
  if (digits.length === 10) {
    return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  
  // If 12 digits (Indian number with country code)
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+${digits.slice(0, 2)} ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  
  // Return original if format doesn't match
  return phone;
}

/**
 * Formats relative time (e.g., "2m ago", "3h ago")
 * Custom implementation without external date library
 * 
 * @param {Date|string} date - Date object or ISO string
 * @returns {string} Relative time string
 */
export function formatRelativeTime(date) {
  if (!date) return '';
  
  const now = new Date();
  const past = new Date(date);
  const diffMs = now - past;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffSecs < 60) {
    return 'just now';
  }
  
  if (diffMins < 60) {
    return `${diffMins}m ago`;
  }
  
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }
  
  // For older dates, return formatted date
  return past.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

/**
 * Formats currency in Indian Rupees
 * e.g., 12000 -> "Rs 12,000"
 * 
 * @param {number} amount - Amount to format
 * @returns {string} Formatted currency string
 */
export function formatCurrency(amount) {
  if (amount === null || amount === undefined) return 'Rs 0';
  
  const formatted = amount.toLocaleString('en-IN');
  return `Rs ${formatted}`;
}

/**
 * Returns Tailwind color class for language badge
 * 
 * @param {string} language - Language code
 * @returns {string} Tailwind color classes
 */
export function getLanguageBadgeColor(language) {
  const colors = {
    hindi: 'bg-orange-100 text-orange-800 border-orange-200',
    marathi: 'bg-purple-100 text-purple-800 border-purple-200',
    english: 'bg-blue-100 text-blue-800 border-blue-200',
    hinglish: 'bg-green-100 text-green-800 border-green-200',
    gujarati: 'bg-pink-100 text-pink-800 border-pink-200',
    unknown: 'bg-gray-100 text-gray-800 border-gray-200'
  };
  
  return colors[language] || colors.unknown;
}

/**
 * Truncates text to specified length with ellipsis
 * 
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated text
 */
export function truncateText(text, maxLength = 50) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

export default {
  formatPhoneDisplay,
  formatRelativeTime,
  formatCurrency,
  getLanguageBadgeColor,
  truncateText
};
