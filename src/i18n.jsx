import { createContext, useContext, useEffect, useState } from 'react';
import { FORM_MESSAGES } from './formTranslations';

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'ta', label: 'தமிழ்' },
  { code: 'te', label: 'తెలుగు' },
];

// Menus and common labels only; longer page text stays in English.
// These translations should be reviewed by native speakers before real patients rely on them.
// Keys are the English text, so anything missing falls back to English.
const MESSAGES = {
  hi: {
    Home: 'होम', Dashboard: 'डैशबोर्ड', Pledge: 'संकल्प', 'My pledges': 'मेरे संकल्प', Requests: 'अनुरोध', 'My requests': 'मेरे अनुरोध',
    Matches: 'मिलान', Records: 'रिकॉर्ड', FAQs: 'सामान्य प्रश्न', 'Our vision': 'हमारा दृष्टिकोण', Contact: 'संपर्क', 'For hospitals': 'अस्पतालों के लिए',
    'Donate organ': 'अंगदान करें', 'Log in': 'लॉग इन', 'Log out': 'लॉग आउट', 'Join the community': 'समुदाय से जुड़ें', 'Open app': 'ऐप खोलें',
    'Hospital portal': 'अस्पताल पोर्टल', 'Patient queue': 'मरीज़ों की सूची', 'Donor registry': 'दाता रजिस्ट्री', Overview: 'सारांश', Hospitals: 'अस्पताल',
    Members: 'सदस्य', Pledges: 'संकल्प', 'Audit log': 'ऑडिट लॉग', Admin: 'प्रशासक', Notifications: 'सूचनाएँ', 'Mark all read': 'सभी को पढ़ा हुआ करें',
    'No notifications yet': 'अभी कोई सूचना नहीं', Language: 'भाषा', Menu: 'मेनू',
    Save: 'सहेजें', Cancel: 'रद्द करें', Next: 'आगे', Back: 'पीछे', Submit: 'जमा करें', Search: 'खोजें', Verify: 'सत्यापित करें', Reject: 'अस्वीकार करें',
    Suspend: 'निलंबित करें', Reinstate: 'बहाल करें', 'Accept match': 'मिलान स्वीकार करें', Decline: 'मना करें', 'Propose match': 'मिलान प्रस्तावित करें',
    'Confirm after medical tests': 'चिकित्सा जाँच के बाद पुष्टि करें', Withdraw: 'वापस लें', Reactivate: 'फिर से सक्रिय करें', Edit: 'संपादित करें',
    'Close request': 'अनुरोध बंद करें', 'Reopen request': 'अनुरोध फिर खोलें', Delete: 'हटाएँ', 'Create a request': 'अनुरोध बनाएँ',
    'Request an organ': 'अंग का अनुरोध करें', 'Pledge to donate': 'दान का संकल्प लें', Review: 'समीक्षा करें', 'Show table': 'तालिका दिखाएँ',
    'Show chart': 'चार्ट दिखाएँ', Previous: 'पिछला', 'Discard draft': 'ड्राफ़्ट हटाएँ', 'Draft saved': 'ड्राफ़्ट सहेजा गया',
    'Your next step': 'आपका अगला कदम', 'Match updates': 'मिलान अपडेट', 'Recent organ requests': 'हाल के अंग अनुरोध', 'Ranked donors': 'क्रमबद्ध दाता',
    'Compare donors': 'दाताओं की तुलना', 'Why this rank': 'यह रैंक क्यों',
    pending: 'लंबित', verified: 'सत्यापित', rejected: 'अस्वीकृत', open: 'खुला', closed: 'बंद', critical: 'गंभीर', urgent: 'तत्काल', stable: 'स्थिर',
    proposed: 'प्रस्तावित', confirmed: 'पुष्ट', declined: 'अस्वीकार', accepted: 'स्वीकृत', active: 'सक्रिय', matched: 'मिलान हुआ', withdrawn: 'वापस लिया',
    suspended: 'निलंबित', living: 'जीवित दाता', 'After death': 'मृत्यु के बाद', Emergency: 'आपातकाल', Standard: 'सामान्य',
    'Awaiting hospital': 'अस्पताल की प्रतीक्षा', 'Verified hospital': 'सत्यापित अस्पताल',
    Submitted: 'जमा किया', Verified: 'सत्यापित', 'Donor proposed': 'दाता प्रस्तावित', 'Donor accepted': 'दाता ने स्वीकारा', Confirmed: 'पुष्ट', Proposed: 'प्रस्तावित',
  },
  ta: {
    Home: 'முகப்பு', Dashboard: 'டாஷ்போர்டு', Pledge: 'உறுதிமொழி', 'My pledges': 'என் உறுதிமொழிகள்', Requests: 'கோரிக்கைகள்', 'My requests': 'என் கோரிக்கைகள்',
    Matches: 'பொருத்தங்கள்', Records: 'பதிவுகள்', FAQs: 'கேள்விகள்', 'Our vision': 'எங்கள் நோக்கம்', Contact: 'தொடர்பு', 'For hospitals': 'மருத்துவமனைகளுக்கு',
    'Donate organ': 'உறுப்பு தானம்', 'Log in': 'உள்நுழை', 'Log out': 'வெளியேறு', 'Join the community': 'சமூகத்தில் சேருங்கள்', 'Open app': 'செயலியைத் திற',
    'Hospital portal': 'மருத்துவமனை தளம்', 'Patient queue': 'நோயாளர் வரிசை', 'Donor registry': 'தானமளிப்போர் பதிவேடு', Overview: 'மேலோட்டம்',
    Hospitals: 'மருத்துவமனைகள்', Members: 'உறுப்பினர்கள்', Pledges: 'உறுதிமொழிகள்', 'Audit log': 'தணிக்கை பதிவு', Admin: 'நிர்வாகி',
    Notifications: 'அறிவிப்புகள்', 'Mark all read': 'அனைத்தையும் படித்ததாகக் குறி', 'No notifications yet': 'இன்னும் அறிவிப்புகள் இல்லை', Language: 'மொழி', Menu: 'பட்டியல்',
    Save: 'சேமி', Cancel: 'ரத்து', Next: 'அடுத்து', Back: 'பின்', Submit: 'சமர்ப்பி', Search: 'தேடு', Verify: 'சரிபார்', Reject: 'நிராகரி',
    Suspend: 'இடைநிறுத்து', Reinstate: 'மீட்டமை', 'Accept match': 'பொருத்தத்தை ஏற்கவும்', Decline: 'மறு', 'Propose match': 'பொருத்தம் முன்மொழி',
    'Confirm after medical tests': 'மருத்துவ பரிசோதனைக்குப் பின் உறுதிசெய்', Withdraw: 'திரும்பப் பெறு', Reactivate: 'மீண்டும் செயல்படுத்து', Edit: 'திருத்து',
    'Close request': 'கோரிக்கையை மூடு', 'Reopen request': 'கோரிக்கையை மீண்டும் திற', Delete: 'நீக்கு', 'Create a request': 'கோரிக்கை உருவாக்கு',
    'Request an organ': 'உறுப்பு கோரு', 'Pledge to donate': 'தானம் செய்ய உறுதியளி', Review: 'பரிசீலி', 'Show table': 'அட்டவணையைக் காட்டு',
    'Show chart': 'வரைபடத்தைக் காட்டு', Previous: 'முந்தைய', 'Discard draft': 'வரைவை நீக்கு', 'Draft saved': 'வரைவு சேமிக்கப்பட்டது',
    'Your next step': 'உங்கள் அடுத்த படி', 'Match updates': 'பொருத்த புதுப்பிப்புகள்', 'Recent organ requests': 'சமீபத்திய உறுப்பு கோரிக்கைகள்',
    'Ranked donors': 'தரவரிசை தானமளிப்போர்', 'Compare donors': 'தானமளிப்போரை ஒப்பிடு', 'Why this rank': 'ஏன் இந்தத் தரம்',
    pending: 'நிலுவையில்', verified: 'சரிபார்க்கப்பட்டது', rejected: 'நிராகரிக்கப்பட்டது', open: 'திறந்துள்ளது', closed: 'மூடப்பட்டது', critical: 'மிக அவசரம்',
    urgent: 'அவசரம்', stable: 'நிலையானது', proposed: 'முன்மொழியப்பட்டது', confirmed: 'உறுதிசெய்யப்பட்டது', declined: 'மறுக்கப்பட்டது', accepted: 'ஏற்கப்பட்டது',
    active: 'செயலில்', matched: 'பொருந்தியது', withdrawn: 'திரும்பப் பெறப்பட்டது', suspended: 'இடைநிறுத்தப்பட்டது', living: 'உயிருள்ள தானம்',
    'After death': 'இறப்புக்குப் பின்', Emergency: 'அவசரநிலை', Standard: 'வழக்கமானது', 'Awaiting hospital': 'மருத்துவமனைக்காகக் காத்திருக்கிறது',
    'Verified hospital': 'சரிபார்க்கப்பட்ட மருத்துவமனை',
    Submitted: 'சமர்ப்பிக்கப்பட்டது', Verified: 'சரிபார்க்கப்பட்டது', 'Donor proposed': 'தானமளிப்பவர் முன்மொழியப்பட்டார்', 'Donor accepted': 'தானமளிப்பவர் ஏற்றார்',
    Confirmed: 'உறுதிசெய்யப்பட்டது', Proposed: 'முன்மொழியப்பட்டது',
  },
  te: {
    Home: 'హోమ్', Dashboard: 'డాష్‌బోర్డ్', Pledge: 'ప్రతిజ్ఞ', 'My pledges': 'నా ప్రతిజ్ఞలు', Requests: 'అభ్యర్థనలు', 'My requests': 'నా అభ్యర్థనలు',
    Matches: 'మ్యాచ్‌లు', Records: 'రికార్డులు', FAQs: 'ప్రశ్నలు', 'Our vision': 'మా దృష్టి', Contact: 'సంప్రదించండి', 'For hospitals': 'ఆసుపత్రుల కోసం',
    'Donate organ': 'అవయవ దానం', 'Log in': 'లాగిన్', 'Log out': 'లాగౌట్', 'Join the community': 'సమాజంలో చేరండి', 'Open app': 'యాప్ తెరవండి',
    'Hospital portal': 'ఆసుపత్రి పోర్టల్', 'Patient queue': 'రోగుల జాబితా', 'Donor registry': 'దాతల రిజిస్ట్రీ', Overview: 'అవలోకనం', Hospitals: 'ఆసుపత్రులు',
    Members: 'సభ్యులు', Pledges: 'ప్రతిజ్ఞలు', 'Audit log': 'ఆడిట్ లాగ్', Admin: 'నిర్వాహకుడు', Notifications: 'నోటిఫికేషన్లు',
    'Mark all read': 'అన్నీ చదివినట్లు గుర్తించండి', 'No notifications yet': 'ఇంకా నోటిఫికేషన్లు లేవు', Language: 'భాష', Menu: 'మెనూ',
    Save: 'సేవ్ చేయండి', Cancel: 'రద్దు', Next: 'తదుపరి', Back: 'వెనుకకు', Submit: 'సమర్పించండి', Search: 'వెతకండి', Verify: 'ధృవీకరించండి',
    Reject: 'తిరస్కరించండి', Suspend: 'నిలిపివేయండి', Reinstate: 'పునరుద్ధరించండి', 'Accept match': 'మ్యాచ్ అంగీకరించండి', Decline: 'తిరస్కరించండి',
    'Propose match': 'మ్యాచ్ ప్రతిపాదించండి', 'Confirm after medical tests': 'వైద్య పరీక్షల తర్వాత నిర్ధారించండి', Withdraw: 'ఉపసంహరించండి',
    Reactivate: 'మళ్లీ సక్రియం చేయండి', Edit: 'సవరించండి', 'Close request': 'అభ్యర్థన మూసివేయండి', 'Reopen request': 'అభ్యర్థన మళ్లీ తెరవండి',
    Delete: 'తొలగించండి', 'Create a request': 'అభ్యర్థన సృష్టించండి', 'Request an organ': 'అవయవం కోసం అభ్యర్థించండి', 'Pledge to donate': 'దానానికి ప్రతిజ్ఞ చేయండి',
    Review: 'సమీక్షించండి', 'Show table': 'పట్టిక చూపించు', 'Show chart': 'చార్ట్ చూపించు', Previous: 'మునుపటి', 'Discard draft': 'డ్రాఫ్ట్ తొలగించండి',
    'Draft saved': 'డ్రాఫ్ట్ సేవ్ అయింది',
    'Your next step': 'మీ తదుపరి అడుగు', 'Match updates': 'మ్యాచ్ అప్‌డేట్లు', 'Recent organ requests': 'ఇటీవలి అవయవ అభ్యర్థనలు', 'Ranked donors': 'ర్యాంక్ చేసిన దాతలు',
    'Compare donors': 'దాతలను పోల్చండి', 'Why this rank': 'ఈ ర్యాంక్ ఎందుకు',
    pending: 'పెండింగ్', verified: 'ధృవీకరించబడింది', rejected: 'తిరస్కరించబడింది', open: 'తెరిచి ఉంది', closed: 'మూసివేయబడింది', critical: 'అత్యవసరం',
    urgent: 'తక్షణం', stable: 'స్థిరంగా', proposed: 'ప్రతిపాదించబడింది', confirmed: 'నిర్ధారించబడింది', declined: 'తిరస్కరించబడింది', accepted: 'అంగీకరించబడింది',
    active: 'సక్రియం', matched: 'మ్యాచ్ అయింది', withdrawn: 'ఉపసంహరించబడింది', suspended: 'నిలిపివేయబడింది', living: 'జీవ దాత', 'After death': 'మరణానంతరం',
    Emergency: 'అత్యవసర పరిస్థితి', Standard: 'సాధారణం', 'Awaiting hospital': 'ఆసుపత్రి కోసం వేచి ఉంది', 'Verified hospital': 'ధృవీకరించిన ఆసుపత్రి',
    Submitted: 'సమర్పించబడింది', Verified: 'ధృవీకరించబడింది', 'Donor proposed': 'దాత ప్రతిపాదించబడ్డారు', 'Donor accepted': 'దాత అంగీకరించారు',
    Confirmed: 'నిర్ధారించబడింది', Proposed: 'ప్రతిపాదించబడింది',
  },
};

const STORAGE_KEY = 'organotale:language';
const LanguageContext = createContext({ language: 'en', setLanguage: () => {} });

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return LANGUAGES.some((l) => l.code === saved) ? saved : 'en';
    } catch {
      return 'en';
    }
  });
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  const setLanguage = (code) => {
    setLanguageState(code);
    try { localStorage.setItem(STORAGE_KEY, code); } catch { /* storage unavailable: keep for this visit only */ }
  };
  return <LanguageContext.Provider value={{ language, setLanguage }}>{children}</LanguageContext.Provider>;
}
export const useLanguage = () => useContext(LanguageContext);
export function useT() {
  const { language } = useContext(LanguageContext);
  return (text) => FORM_MESSAGES[language]?.[text] ?? MESSAGES[language]?.[text] ?? text;
}
