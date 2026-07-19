/**
 * Follow-up message templates for different stages and languages
 * 
 * Messages are designed to be:
 * - Warm and professional
 * - 2-3 lines each
 * - Natural and conversational (not robotic)
 * - Culturally appropriate for each language
 */

/**
 * Gets the appropriate follow-up message for a given stage and language
 * 
 * @param {string} stage - Follow-up stage: '3hr' | '1day' | '3day' | '7day'
 * @param {string} language - Language: 'hindi' | 'marathi' | 'english' | 'hinglish' | 'gujarati'
 * @param {string} customerName - Customer's name (optional, for personalization)
 * @returns {string} Follow-up message
 */
function getFollowUpMessage(stage, language, customerName = null) {
  const greeting = customerName ? `${customerName} ji, ` : '';
  
  const templates = {
    '3hr': {
      hindi: `${greeting}koi aur sawal hai toh batayein. Hum aapki help ke liye hazir hain! 😊`,
      marathi: `${greeting}काहीतरी प्रश्न असतील तर सांगा. आम्ही तुमच्या मदतीसाठी तयार आहोत! 😊`,
      english: `${greeting}Any questions? We're here to help! 😊`,
      hinglish: `${greeting}koi aur sawal hai toh batayein. Hum aapki help ke liye hazir hain! 😊`,
      gujarati: `${greeting}કોઈ પ્રશ્ન હોય તો કહો. અમે તમારી મદદ માટે તૈયાર છીએ! 😊`
    },
    '1day': {
      hindi: `${greeting}weekend dates jaldi bhar jaate hain. Dates confirm kar lijiye, best rooms mil jayenge! 🏨`,
      marathi: `${greeting}वीकेंडच्या तारखा लवकर भरतात. तारखा पक्का करा, सर्वोत्तम खोल्या मिळतील! 🏨`,
      english: `${greeting}Weekend dates fill up fast. Confirm your dates to get the best rooms! 🏨`,
      hinglish: `${greeting}weekend dates jaldi bhar jaate hain. Dates confirm kar lijiye, best rooms mil jayenge! 🏨`,
      gujarati: `${greeting}વીકેન્ડની તારીઓ ઝડપથી ભરાઈ જાય છે. તારીઓ પક્કી કરો, શ્રેષ્ઠ રૂમ મળશે! 🏨`
    },
    '3day': {
      hindi: `${greeting}pool, kayaking aur mountain views aapka intezaar kar rahe hain. Plan karein, aapko pasand aayega! 🌊`,
      marathi: `${greeting}पूल, कायाकिंग आणि माउंटन व्ह्यूज तुमची वाट पाहत आहेत. प्लान करा, तुम्हाला आवडेल! 🌊`,
      english: `${greeting}The pool, kayaking, and mountain views are waiting for you. Plan your visit, you'll love it! 🌊`,
      hinglish: `${greeting}pool, kayaking aur mountain views aapka intezaar kar rahe hain. Plan karein, aapko pasand aayega! 🌊`,
      gujarati: `${greeting}પૂલ, કાયાકિંગ અને માઉન્ટેન વ્યૂ તમારી રાહ જુએ છે. પ્લાન કરો, તમને ગમશે! 🌊`
    },
    '7day': {
      hindi: `${greeting}jab bhi aap ready ho, hum hain. Call karein: 9257657665. Nandibaag aapka swagat karega! 🙏`,
      marathi: `${greeting}जेव्हा तुम्ही तयार असाल, तेव्हा आम्ही आहोत. कॉल करा: 9257657665. नंदीबाग तुमचे स्वागत करेल! 🙏`,
      english: `${greeting}Whenever you're ready, we're here. Call us: 9257657665. Nandibaag welcomes you! 🙏`,
      hinglish: `${greeting}jab bhi aap ready ho, hum hain. Call karein: 9257657665. Nandibaag aapka swagat karega! 🙏`,
      gujarati: `${greeting}જ્યારે પણ તમે તૈયાર હો, અમે છીએ. કૉલ કરો: 9257657665. નંદીબાગ તમારું સ્વાગત કરશે! 🙏`
    }
  };
  
  // Default to English if language not found
  const languageTemplates = templates[stage] || templates['3hr'];
  const message = languageTemplates[language] || languageTemplates['english'];
  
  return message;
}

module.exports = { getFollowUpMessage };
