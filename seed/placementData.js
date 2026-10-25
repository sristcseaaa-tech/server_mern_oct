// Placement records transcribed from the official page
// https://srist.in/training-and-placement/ (Placement Report 2022, 2021,
// 2020, 2019 and "More Placements"). Loaded from the admin screen
// (Placement Management → Load SRIST records) — it never overwrites or
// duplicates anything already stored.
//
// Line format:   DEPT | Company 1; Company 2 | Name, Name, Name
// "@2022" sets the year; "@MORE" = entries the source does not date.
// Names are written as in the source (spelling kept); exact repeats of the
// same student + company + year are dropped on import.

export const SEED_STORIES = [
  { studentName: "Souvik Nandi", department: "Mechanical Engineering (ME)", company: "Ashok Leyland", photo: "https://srist.in/wp-content/uploads/2022/07/souvik-nandi.webp", order: 1 },
  { studentName: "Animesh Basu", department: "Computer Science & Technology (CST)", company: "Tech Mahindra", photo: "https://srist.in/wp-content/uploads/2022/07/animesh-jana-1.webp", order: 2 }
];

export const SEED_RAW = `
@2022
CE | RG Solutions | Tanmay Kirtania, Kashinath Debnath, Rohit Bhattacharjee, Tanmoy Kirtaniya
EE | RG Solutions | Bishal Dawn, Biplab Karan
EE | Debson Pumps | Nihal Bara
ETCE | Security Engineers Pvt Ltd | Manabendra Roy
ETCE | Baid Power Services Pvt Ltd | Abdul Rafiul Mallick, Arijit Bhattacharjee
ETCE | Tikona | Aloke Kr Gupta
ETCE | Experteez Technology Pvt Ltd | Nirvana Palit
ETCE | Dhoot Transmission | Pulak Middya, Sneha Dutta, Arijit Bhattacharjee, Pulak Middye
ME | PS Group | Soumen Ghosh, Sachin Kumar Kamat
CE | PS Group | Prabir Goswami, Abhishek Mukherjee, Kunal Mondal
EE | Dhoot Transmission | Sudipta Rana, Biswajit Boliar, Navin Kr Tiwari, Somrath Roy, Dipshikha Dey, Sandipta Rana, Somnath Roy, Navin Kumar Tiwari
CE | A.M Civil Contractor Pvt Ltd | Suvadeep Burman, Shyamal Bhandari
 | Dhoot Transmission | Goutam Patra, Biswajit Bolidhar
ME | Dhoot Transmission | Akash Das, Goutam Das, Obaidur Laskar, Rajan Bera, Arnab Kayal, Arnab Halder, Ayush Ghosh Dastida, Koushik Ghosh, Somrik Das, Animesh Paik, Mukund Mishra, Chayan Halder
AUTOMOBILE | Dhoot Transmission | Vikash Dattu Pandey

@2021
ETCE | JioMart | Manabendra Roy
CST | JioMart | Koyel Pramanck
ME | Badve Engineering Limited | Dipak Baitalik, Shree Ramkrishna, Bappaditya Midya, Adrish Khan, Akash Das, Abhisek Paul, Souvik Halder, Sasanka Bar, Souvik Sarder, Bikram Sarkar, Tanmay Biswas
ME | Sigma Electric | Md Monowar Hossain, Biswajit Sahoo, Rupam Roy, Sk Sakhawat, Krishna Kanta Middya, Binay Krisna Mandal, Nemai Bhowmik, Krishnendu Ghosh, Sk Ajharuddin, Satya Prakash Singha, Sabyasachi Das, Sourav Mondal, Souvik Mandal, Abhishek Mondal, Sumit Ghosh, Susovan Jana, Suvendu Mondal, Souvik Mondal, Kaushik Mondal
ME | Sigma Electric; Shivam Auto; Badve Engineering Limited; Laxmi Agni Components | Ranajoy Ghorai
ME | Sigma Electric; Laxmi Agni Components | Jahirul Sardar
ME | Badve Engineering Limited; Shivam Auto; EPL Limited | Ankit Kumar
ME | Badve Engineering Limited; Shivam Auto; Laxmi Agni Components | Prabir Khamaru
ME | Endurance Technology | Prashanta Dandapat, Sk. Sakhawat, Triasha Saha, Akash Das, Siddhartha Denray
ME | Endurance Technology; Shivam Auto; Badve Engineering Limited; Sigma Electric | Ramananda Maity
ME | Endurance Technology; Laxmi Agni Components; Badve Engineering Limited; EPL Limited | Sk Aman Suman
ME | Endurance Technology; Shivam Auto; Laxmi Agni Components | Rahul Dhangar
EE | S.B Enterprise; Laxmi Agni Components; Microtek Technology | Rishi Raj Chakraborty
EE | S.B Enterprise | Subrata Giri
ME | Shivam Auto | Mohan Kumar, Arghya Pathak
ME | Shivam Auto; Laxmi Agni Components | Rajesh Haldar, Amit Mondal, Subharadip Rana, Tanay Dhar
ME | Shivam Auto; Laxmi Agni Components; Badve Engineering Limited | Milan Sardar
ME | Laxmi Agni Components | Sandipan Debnath
 | Laxmi Agni Components | Anirban Mondal
EE | Laxmi Agni Components; EPL Limited; Microtek Technology | Mrinmoy Bijli, Soumyajit Dey
EE | Laxmi Agni Components; Microtek Technology | Nilutpal Mondal, Biplob Karan, Anshu Raj
ME | EPL Limited; Sap & Pap | Souvik Mondal
EE | EPL Limited; Microtek Technology | Mrinmoy Mohapatra
ME | Laxmi Agni Components; EPL Limited | Debkumar Maity
EE | Microtek Technology | Souvik Paul, Sudipta Halder, Subhendu Adhikary, Souvik Jana
EE | Mayfair Group | Jaya Mondal, Shamal Bhandari, Subhasish Das, Tilanjali Kar
CE | Mayfair Group | Aritra Dutta, Tufan Charan, Pratik Dey
ME | Sap & Pap | Ankan Baidya, Kailash Halder
ME | Sap & Pap; Badve Engineering Limited | Gouranga Priyo Biswas
ME | Ipsen Technologies | Vimal Kumar, Manasij Das, Debkumar Maity
ME | Alliance Medical Equipment | Sudipto Das
ARCH | Consol Kolkata Architect | Payel Das
CE | PS Group | Amit Kr Roy, Susmita Naskar
CE | Shrikrishna Automobiles | Md. Asim Javed Molla

@2020
CST | Skyram Technologies | Sweta Dutta
EE | JUVAS (unit of ESSEE Networks Pvt Ltd) | Subhadip Sardar, Anshu Raj, Rahul Kumar, Arindam Sarkar, Animesh Gazi, Abu Salam Gazi, Golam Mortaza, Aniruddha Bhattacharya, Sahin Haque, Gulzar Hussain, Debjit Halder, Soumen Jana, Soumyojit Dey, Ashu Raj
ETCE | JUVAS (unit of ESSEE Networks Pvt Ltd) | Meghdeep Kr Sahu, Mrinmoy Manna, Bibekananda Nayak, Riju Mohanta, Subhajit Ghosh
ITI | JBM Auto Ltd (Integrated Personnel Services Limited) | Pradip Das, Neeraj Prasad, Md Saddam, Victor Singha, Rajib Sana, Shashi Kant, Krishna Pada Mondal, Sanjib Panchal
ME | JBM Auto Ltd (Integrated Personnel Services Limited) | Animesh Manna, Arindam Pramanick, Naresh Adhikary, Shambhu Shaw, Mukund Kumar, Syed Anas Abdullah, Soumitra Das, Narayan Chandra Hait, Debasis Pradhan, Tanmoy Das, Jayanta Mallick, Asim Sanki, Koushik Khamrui, Sudip Das, Avranil Chowdhury, Indranil Biswas, Dayananda Roy, Injamul Sk, Kailash Halder, Pritam Das, Hrishikesh Gayen, Subhajit Dal, Pintu Mondal, Bidhubhushan Das, Surojit Parida, Rajkumar Manna, Debasis Santra, Sondipan Debnath, Malay Kumar Dolai, Debjit Kundu, Anjan Das, Biwajit Panda, Dipak Mandal, Dipak Baitalik, Sourav Mondal, Ayan Baidya, Tanay Dhar, Monowar Hossain, Arnab Khanra, Anirban Mondal, Siladitya Mazumder
EE | Essel Propack Ltd | Sowvik Paul, Abu Salim Gazi, Subhadip Sardar
ME | Essel Propack Ltd | Sachin Kumar Kamat, Krishnedu Das, Sudip Das, Vimal Kumar, Binod Kumar Das, Vaibhav Acharya, Rishi Kumar Giri, Animesh Kansari, Tapan Adhikary, Subhajit Kantal, Indranil Biswas, Ayan Kulay, Sovan Manna, Amit Kumar Jana, Soumen Adhikari, Sanju Das, Souvik Pramanik, Gouranga Priyo Biswas, Shibayan Chakraborty, Souvik Halder, Milan Sardar
 | Essel Propack Ltd | Malay Kumar Dolai

@2019
ME | Hailstone Innovations | Souviki Guchait, Sk Ataur Rahaman, Animesh Maity, Soumen Mondal, Tanmoy Bera, Chattu Singh, Sk Nurul Hossain, Ardhendu Bag, Mehabub Reja Sardar, Surjyakanta Seth, Sovan Naskar, Debkumar Maity, Sourav Roy
ME | SAP WAP Pvt Ltd | Proloy Das, Pushpanjan Charan, Arka Dey Tapadar
ME | Mayurbhanj Metals Ltd | Rajib Shaw, Asim Kr Mondal
ME | Bluestar Ltd (Subsidiary) | Sourav Patali, Subhash Mondal, Biswajit Saha, Alapan Das
ETCE | Business Alphabets Corporation | Abhishek Gupta, Puspita Majhi, Mousumi Singh, Aditi Halder, Shilpa Chatterjee, Tanusree Dey
ME | SANY Heavy Industry India Pvt Ltd | Sudip Sadhukha, Sayantan Das, Kausanik Naskar, Tanumay Dey
CST | CMS IT Ltd | Kiranmoy Mondal, Swadin Kumar Roy
ETCE | CMS IT Ltd | Mousumi Singh, Abhishek Gupta, Roushan Ranjan
ETCE | DD Group | Amalendu Ghosh

@MORE
ME | Shivam Autotech Ltd | Anil Pal, Nayan Dey, Dipon Kirtonia, Subrata Kumar Jana, Biswajit Adak, Avijit Pal, Ranjan Das, Sourav Pal, Gopal Mondal
EE | Shivam Autotech Ltd | Pralay Mondal
EE | IJPN Technologies (East) | Sreejit Maitra, Biswajit Bose, Pritam Nandi
ETCE | IJPN Technologies (East) | Surjonarayan Ghosh
CE | S.M. Interior Pvt Ltd | Dipankar Das, Somnath Das, Saikat Das
ME | Linde India Ltd | Madhusudan Manna, Md. Rejaul Alam
EE | Exicom Telesystem Ltd | Abhishek Sadhukha
CE | Cyber Swift Pvt Ltd | Somnath Das, Silajit Boliar
ME | Manlift | Kunal Sarkar, Bipul Maity, Pushpendu Bera, Lewellyn Raymond Graham, Suvashis Das, Abhisek Paul, Tamal Naiya, Shailesh Shukla, Joy Narayan Khatua, Taslim Arif Mallik, Nandan Kundu, Tanmay Kumar Samanta, Chhatu Sing, Mehebub Reja Sarder, Md. Sherajuddin, Md. Rashid Nehal, Md. Shahud, Bappa Saha, Sital Garai, Sayan Chhattopadhyay, Soumen Manna, Vivekanand Sharma, Kumud Ranjan Jha, Somnath Baidya, Soumyadip Biswas, Saptorshi Ghosh, Soheb Nawaz, Kingshuk Mukherjee, Manas Chatterjee, Sumit Ghosh, Tanmoy Chakrabarty, Subhankar Saha, Sudip Haldar, Sk Nurul Hosen, Buddhadev Batul, Sk Abul Hossain, Shahbaz Ahmed, Ardhendu Sarkar, Sk Ataur Rahaman, Nitesh Kr Shaw, Biswanath Bag, Krishna Kanta Sen, Safique Molla, Ananda Purkait, Biswajit Mondal, Souvik Guchait, Suraj Banik, Biswajit Kayal, Subrata Paul, Arit Bank, Susovan Manna, Rahul Prasad Mahto, Sourav Saha, Sudipta Gayen, Biswajit Bera, Pritom Das, Rakesh Mondal, Prasanta Dandapat, Shubham Sarkar, Amritendu Sasmal, Soumen Mondal, Subrata Maity, Sagnik Chakraborty, Arindam Mondal, Anup Bhuina, Debasis Bera, Santanu Banerjee, Bapi Pahari, Sumit Das, Padma Suraj Pramanik
ME | Maruti (Vendors) | Biswajit Das, Rupam Roy, Md Shahud, Shouvik Sarkar, Soumen Mondal
EE | Tikona | Ripon Das, Laxman Chandra Mahato, Ritik Ghosh, Mehedi Hassan Mondal, Soumya Choudhury, Praskanna Mukherjee, Avijit Chakrabarty, Susobhan Pal, Suman Kar, Suvro Sarkar, Sourav Roy, Rakesh Purkait, Suvam Chakrabarty, Prasanta Saha, Chinmoy Das, Bisweswar Gayen, Akash Sen, Surajit Ghosh, Monojit Mondal, Samiran Giri, Amit Sahu
ETCE | Tikona | Biswajit Roy, Ritesh Bera, Gaurav Singh, Amit Biswas, Shuvam Das, Souvik Naskar, Sandip Kumar Singh, Kalyan Sardar, Subham Ghosh, Bijan Mridha, Subhadip Ghosh, Atish Gayen
ME | GLS | Arka Narayan Jas, Sovan Samanta, Prabhash Das, Akash Das, Sayan Chattopadhyay, Santanu Banerjee, Anjan Kumar Swain, Soumyadip Biswas, Bappa Saha, Jay Gopal Shaw, Taslim Arif Mallik
ME | VKC Group of Companies | Taslim Arif Mallik, Shahbaz Ahmed
ME | JBM | Subrato Saha, Sk Abul Hossain, Md. Aquib Raza, Sk Sikandar, Dipesh Mondal, Suman Pal, Tanmay Kumar Samanta, Amar Singh Mahato, Bipul Maity, Tanmoy Chakraborty, Kunal Sarkar, Umasankar Maity, Abhishek Paul, Joy Narayan Khatua, Sudip Halder, Saptarshi Roy, Koushik Samanta, Souvik Hati, Pushpendu Bera, Somnath Baidya, Soumyadip Biswas, Radhika Ranjan Jana, Najmul Hussain Monda, Samir Das, Subham Kanti Ghosh, Nayanjit Paul, Vivekananda Sharma, Mahammadpur Hussainpur, Sk Sahid Akhtar, Amit Kumar Singh, Sayan Chattopadhyay, Biswanath Bag, Rahim Sk, Sanat Kumar Mahato, Nitesh Kr Shaw, Subrata Khan, Partha Sardar, Sagnik Chakraborty, Prabhash Das, Sumit Ghosh, Manas Chatterjee, Kumud Ranjan Jha, Zina Khatun Sanfui, Jay Gopal Shaw, Sovan Samanta, Prasanta Dandapat, Subhankar Ghosh, Krishnakanta Sen, Bapi Pahari, Sumit Das, Bappa Saha, Tubai Dalui, Subhadip Das, Anup Bhuina, Sital Garai, Soumen Mondal, Souvik Guchait, Biswajit Mondal, Buddhadev Batul, Tanmoy Bhakta, Souvik Giri, Soheb Nawaz
CE | ACC Concrete | Aloke Sardar
ME | Tenneco | Sourav Barik, Umasankar Maity
ETCE | Tele Tech | Shuvadip Karmokar
ETCE | Hadwise Technologies Pvt Ltd | Subham Chatterjee
CE | L&T | Anirban Das, Siladitya Dey, Kousik Bhunia, Pritam Saraswati
CE | Universal Bituminous Limited | Raja Mondal
CE | TSS | Nitish Mishra, Sujan Kumar Das, Rohit Bhattacharya, Amiya Jana, Suraj Mondal, Sayani Dey, Chayan Banerjee
CE | BGDPL | Aritra Mondal, Souptik Mandal, Suvam Mondal
EE | BGDPL | Ranjit Das
ETCE | BGDPL | Gaurav Singh
CE | Pecon Software Ltd | Happy Sarkar, Dibyendu Dey, Loknath Bishal, Arindam Basak, Prasenjit Das, Soumen Mondal, Snehabrati Saha
EE | Pecon Software Ltd | Beas Bera
ETCE | Pecon Software Ltd | Upasana Basu
EE | Integrated Personnel Solution Pvt Ltd | Dipesh Mondal
CST | VAP Technology | Avick Roy Chowdhury, Debayan Chakraborty, Dipsi Aich, Uttam Sharma, Ashis Kumar Ray, Priti Ruj, Sagardeep Ghosh, Sanjeev Sharma, Arka Sarkar
ME | Rajsriya Automotive Pvt Ltd | Chhatu Sing, Sk Nurul Hossen, Arka Dey Tapadar, Sudipta Mondal, Pratik Ghosh, Subrata Paul, Sanjit Haldar, Surya Pramanik, Deep Kumar Saha, Aparna Maity, Sunil Jaiswal, Ajit Kumar Prasad
ME | Voltas | Reeshav Kumar Karna
ME | Hailstone Innovations | Gourab Paul, Krishan Haldar, Rocky Majumder, Sakil Ahamed Gazi, S K Sikander, Sourav Chanda
CE | Ceinsys Tech Ltd | Hasan Molla, Suprobhat Paul, Subhadip Sarkar, Sushmit Badiya, Dibatidya Paul, Pranay Kumar Adak
ME | Ceinsys Tech Ltd | Amritendu Sasmal, Arghya Pathak, Md. Rashid Nehal, Satyabata Ghosh
CE | HCM Milestone Pvt Ltd | Susmita Das, Priyankar Mukherjee, Rama Pahari, Sajal Dutta, Pravas Jana, Balaram Sarkar, Saheli Ghosh, Saikat Chakraborty, Manish Sharma
ME | HCM Milestone Pvt Ltd | Souradip Mukherjee
`;

// -> [{ studentName, department, companies[], year|null }]
export function parseSeed(raw = SEED_RAW) {
  const out = [];
  let year = null;
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t && !line.startsWith(" ")) continue;
    if (t.startsWith("@")) { year = t === "@MORE" ? null : Number(t.slice(1)); continue; }
    const parts = line.split("|").map((s) => s.trim());
    if (parts.length < 3) continue;
    const [department, companies, names] = parts;
    const list = companies.split(";").map((c) => c.trim()).filter(Boolean);
    for (const n of names.split(",").map((x) => x.trim()).filter(Boolean)) {
      out.push({ studentName: n, department, companies: list, year });
    }
  }
  return out;
}
