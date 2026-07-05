/**
 * @fileoverview Form Template Library
 * Contains pre-analyzed JSON results for common Indian forms.
 * Allows users to view forms even without uploading photos (offline capability).
 * @module template-library
 */

export class TemplateLibrary {
  constructor() {
    this.templates = [
      {
        id: 'sbi-account-opening',
        name: 'SBI Account Opening',
        icon: '🏦',
        category: 'bank',
        result: {
          form_name: 'SBI Savings Account Opening Form',
          purpose: 'New savings account open karne ke liye bank branch form',
          fields: [
            { label: 'Name', explanation: 'Aapka poora naam (First, Middle, Last)', example: 'Ravi Kumar Sharma', category: 'personal', display_type: 'plain' },
            { label: 'Date of Birth', explanation: 'Aapki janm tithi DD/MM/YYYY format mein', example: '15/08/1990', category: 'personal', display_type: 'boxed' },
            { label: 'PAN Number', explanation: 'Aapka 10 digit PAN card number', example: 'ABCDE1234F', category: 'documents', display_type: 'boxed' },
            { label: 'Aadhaar Number', explanation: 'Aapka 12 digit Aadhaar number', example: '1234 5678 9012', category: 'documents', display_type: 'boxed' },
            { label: 'Mobile Number', explanation: 'Aapka 10 digit mobile number', example: '9876543210', category: 'contact', display_type: 'boxed' },
            { label: 'Current Address', explanation: 'Aapka poora ghar ka pata', example: 'Flat 102, Shanti Nagar, Mumbai', category: 'address', display_type: 'plain' }
          ],
          documents_needed: ['Aadhaar Card copy', 'PAN Card copy', '2 Passport size photos'],
          tips: 'Form ko BLACK ya BLUE pen se CAPITAL letters mein bharein. Overwriting na karein.'
        }
      },
      {
        id: 'pan-form-49a',
        name: 'PAN Card (Form 49A)',
        icon: '💳',
        category: 'govt',
        result: {
          form_name: 'Form 49A - PAN Card Application',
          purpose: 'Naye PAN card apply karne ke liye form',
          fields: [
            { label: 'Assessing Officer (AO) code', explanation: 'Apne area ka AO code bharein (NSDL website se milega)', example: 'MUM/W/11/1', category: 'other', display_type: 'boxed' },
            { label: 'Full Name', explanation: 'Shri/Smt tick karein aur naam likhein', example: 'Shri Amit Verma', category: 'personal', display_type: 'plain' },
            { label: 'Father\'s Name', explanation: 'Pita ka naam likhein (Shaadi shuda auraton ko bhi pita ka naam hi likhna hai)', example: 'Suresh Verma', category: 'family', display_type: 'plain' },
            { label: 'Date of Birth', explanation: 'Aapki janm tithi', example: '10/05/1985', category: 'personal', display_type: 'boxed' }
          ],
          documents_needed: ['Aadhaar Card (for ID, Address & DOB proof)', '2 recent color photos'],
          tips: 'Signatures sirf diye gaye box ke andar hi hone chahiye. Photo par cross sign karein.'
        }
      },
      {
        id: 'post-office-sb',
        name: 'Post Office Savings',
        icon: '📮',
        category: 'bank',
        result: {
          form_name: 'Post Office Savings Account Form',
          purpose: 'Post office mein bachat khata (Savings account) kholne ke liye',
          fields: [
            { label: 'Name of Applicant', explanation: 'Aapka poora naam', example: 'Meena Devi', category: 'personal', display_type: 'plain' },
            { label: 'Account Type', explanation: 'Single ya Joint par tick karein', example: 'Single', category: 'other', display_type: 'plain' },
            { label: 'Initial Deposit', explanation: 'Kitne paise se account khol rahe hain (Words and Figures)', example: 'Rs. 500 (Five Hundred Only)', category: 'financial', display_type: 'plain' },
            { label: 'Nomination', explanation: 'Kise nominee banana chahte hain uska naam', example: 'Rahul Kumar (Son)', category: 'family', display_type: 'plain' }
          ],
          documents_needed: ['Aadhaar Card', 'PAN Card', '3 Passport photos'],
          tips: 'Nomination zaroor bharein taaki aage chalkar koi pareshani na ho.'
        }
      }
    ];
  }

  getTemplates() {
    return this.templates;
  }

  getTemplateById(id) {
    return this.templates.find(t => t.id === id);
  }
}
