/* =====================================================================
   SAMPLE DATA. Every name, rating, review, CRN and section is invented.
   No real UTEP faculty member is represented. Replace this file with
   fetches against a real API in Build order phase 3 (see CLAUDE.md).
   ===================================================================== */

const STUDENT = {
  name:"Alex Delgado", program:"B.S. in computer science", catalog:"2023-2024",
  earned:78, required:120, term:"Spring 2027"
};

const PRIOR_MEAN = 4.20, PRIOR_N = 12;
const W_EVAL = 0.5, W_RMP = 0.5;
const DIST_KEYS = ["Excellent","Good","Satisfactory","Poor","Very Poor"];
const REVIEWS_PER_PAGE = 3;

function mkProf(o){
  const n = o.evalN || 0;
  o.evalAdj = n ? (PRIOR_MEAN*PRIOR_N + o.evalRaw*n) / (PRIOR_N + n) : null;
  o.reviews = (REVIEWS[o.name] || []).map(a => ({
    course:a[0], date:a[1], q:a[2], d:a[3], wta:a[4], grade:a[5], tags:a[6], text:a[7]
  }));
  return o;
}

/* [course, date, quality, difficulty, wouldTakeAgain, grade, tags, text] */
const REVIEWS = {
"Rosalind Vega":[
 ["CS 3350","Apr 2026",5,3,true,"A",["Clear grading criteria","Respected"],"Pumping lemma finally made sense after her third example. Every proof she works in class gets posted the same day."],
 ["CS 3350","Mar 2026",5,4,true,"B+",["Tough grader","Lots of homework"],"Not an easy A but you will know the material. Weekly problem sets take real time."],
 ["CS 3350","Dec 2025",4,4,true,"B",["Test heavy"],"Two midterms and a final, all fair. The practice exams overlap heavily with the real ones."],
 ["CS 3350","Nov 2025",5,3,true,"A-",["Caring","Accessible outside class"],"Answers email within a day, even on weekends. Office hours are worth going to."],
 ["CS 1301","May 2025",4,2,true,"A",["Amazing lectures"],"Took her for intro years ago and signed up again for automata. Same energy."],
 ["CS 3350","Apr 2025",3,4,true,"B-",["Get ready to read"],"Great instructor but the pace assumes you remember discrete math cold. Review before the semester."],
 ["CS 3350","Dec 2024",5,3,true,"A",["Inspirational","Gives good feedback"],"Made theory feel useful instead of abstract. Changed which electives I signed up for."],
 ["CS 3350","Oct 2024",4,4,true,"B+",["Participation matters"],"Cold calls happen. Sit near the front and it is fine."]
],
"Desmond Ocheltree":[
 ["CS 3350","May 2026",2,5,false,"C",["Tough grader","Test heavy"],"Lectures come straight off the slides and exams look nothing like the homework. The curve saved most of us."],
 ["CS 3350","Apr 2026",4,4,true,"B",["Get ready to read","Respected"],"Knows the field cold and harder questions get real answers. Keep up with the reading and it is fine."],
 ["CS 3350","Dec 2025",2,5,false,"C+",["Skip class? You won't pass"],"No slides posted, no recordings. Miss one lecture and you are behind for a week."],
 ["CS 4370","Aug 2025",3,5,false,"B-",["Lots of homework"],"Fair but demanding. Do not take this next to two other systems courses."],
 ["CS 3350","May 2025",3,4,true,"B",["Tough grader"],"Grading is strict but consistent. You always know why you lost points."],
 ["CS 3350","Apr 2025",2,5,false,"D",["Graded by few things"],"Three exams, nothing else. One bad day ends your semester."],
 ["CS 3350","Dec 2024",4,4,true,"A-",["Respected","Gives good feedback"],"Underrated. Went to office hours weekly and my grade went up a full letter."],
 ["CS 3350","Nov 2024",3,5,false,"C+",["Beware of pop quizzes"],"Pop quizzes most Fridays. Attendance is technically optional and practically mandatory."]
],
"Marisol Cantu-Reyes":[
 ["CS 3432","May 2026",5,3,true,"A",["Amazing lectures","Clear grading criteria"],"Built a pipelined CPU in Verilog over the semester and she scaffolded every step."],
 ["CS 3432","Apr 2026",5,3,true,"A-",["Caring","Accessible outside class"],"Asks questions without making you feel stupid. Labs graded within days."],
 ["CS 3432","Dec 2025",5,4,true,"A",["Group projects"],"Assigns the teams herself, which avoided the usual dead weight problem."],
 ["CS 3432","Nov 2025",4,4,true,"B+",["Participation matters"],"Cold calls during lecture. Kept me awake and I learned it."],
 ["CS 3432","May 2025",5,3,true,"A",["Gives good feedback"],"Detailed comments on every lab report. Rare at this level."],
 ["CS 3432","Apr 2025",4,3,true,"B+",["Test heavy"],"Exams are the bulk of the grade but the study guides are accurate."],
 ["CS 3432","Dec 2024",5,2,true,"A",["Inspirational"],"Best professor in the department. Take anything she teaches."],
 ["CS 3432","Oct 2024",4,4,true,"B",["Lots of homework"],"Weekly labs on top of problem sets. Heavy but nothing is busywork."]
],
"Hollis Brandt":[
 ["CS 3432","Apr 2026",4,4,true,"B",["Tough grader","Get ready to read"],"Hardware sections are excellent, the assembly unit drags. Exams are open note."],
 ["CS 3432","Mar 2026",5,4,true,"A-",["Respected"],"Take the Wednesday night section. Three hours sounds brutal but it is one lab instead of two."],
 ["CS 3432","Dec 2025",4,4,true,"B+",["Test heavy"],"Two exams and a final. Study the practice sets, the overlap is heavy."],
 ["CS 3432","Nov 2025",3,5,false,"C+",["Lots of homework"],"Workload is out of proportion to the credit hours."],
 ["CS 3432","May 2025",5,3,true,"A",["Accessible outside class","Caring"],"Stayed late to debug my lab twice. Genuinely wants people to pass."],
 ["CS 3432","Apr 2025",4,4,true,"B",["Clear grading criteria"],"Rubrics posted ahead of time and followed exactly."],
 ["CS 3432","Dec 2024",3,4,true,"B-",["Skip class? You won't pass"],"Slides are sparse. Your notes are the real textbook."],
 ["CS 3432","Oct 2024",5,4,true,"A-",["Gives good feedback"],"Marks up code in detail. My style improved a lot."]
],
"Terrance Whitlock":[
 ["CS 4311","May 2026",4,4,true,"B+",["Group projects","Beware of pop quizzes"],"Semester long project with a real client. Great for a resume, hard on a schedule."],
 ["CS 4311","Apr 2026",3,4,true,"B",["Group projects","Tough grader"],"Grade depends heavily on teammates, which was frustrating."],
 ["CS 4311","Dec 2025",5,3,true,"A",["Inspirational","Accessible outside class"],"Industry background shows. The code review sessions changed how I write software."],
 ["CS 4311","Nov 2025",3,4,false,"B-",["Lots of homework"],"Sprint deliverables every two weeks on top of exams."],
 ["CS 4311","May 2025",4,3,true,"A-",["Respected"],"Clear expectations, no surprises. Solid course."],
 ["CS 4311","Apr 2025",2,5,false,"C",["Graded by few things"],"The project is 60% of the grade. Bad team, bad semester."],
 ["CS 4311","Dec 2024",4,4,true,"B+",["Clear grading criteria"],"Rubric for every deliverable. Follow it and you do fine."],
 ["CS 4311","Oct 2024",4,3,true,"B",["Gives good feedback"],"Reviews every pull request personally, which is more than most."]
],
"Ingrid Sallenbach":[
 ["CS 4311","May 2026",5,3,true,"A",["Amazing lectures","Clear grading criteria"],"First time teaching this and already better run than most courses in the department."],
 ["CS 4311","May 2026",5,2,true,"A",["Caring","Gives good feedback"],"Small class, lots of attention. Extended a deadline when half of us had a conflicting exam."],
 ["CS 4311","Apr 2026",5,3,true,"A-",["Accessible outside class"],"Replies to email at odd hours. Clearly still enthusiastic."],
 ["CS 4311","Apr 2026",4,3,true,"B+",["Group projects"],"The course is still finding its footing but she adjusts fast when something is not working."],
 ["CS 4311","Mar 2026",5,2,true,"A",["Respected"],"Only five of us have rated her so far. Take the numbers lightly, but she was great."]
],
"Bo Ferreira-Lindqvist":[
 ["CS 4311","May 2026",4,3,true,"B+",["Online savvy","Clear grading criteria"],"Fully async and actually built for it. Short videos, weekly deadlines, no busywork."],
 ["CS 4311","Apr 2026",3,4,false,"B-",["Online savvy","Tough grader"],"Fine if you are disciplined. Almost no live contact, so you teach yourself."],
 ["CS 4311","Dec 2025",4,3,true,"A-",["Gives good feedback"],"Written comments on every submission, which is rare for an online section."],
 ["CS 4311","Nov 2025",2,4,false,"C+",["Graded by few things"],"Four assignments total. Feedback comes back too late to apply to the next one."],
 ["CS 4311","May 2025",4,3,true,"B+",["Online savvy"],"Recorded lectures are well edited. Better than most in person courses I have taken."],
 ["CS 4311","Apr 2025",3,3,true,"B",["Respected"],"Competent and organized, just not memorable."],
 ["CS 4311","Dec 2024",4,4,true,"B+",["Lots of homework"],"Weekly deliverables keep you honest. Do not fall behind."],
 ["CS 4311","Oct 2024",3,3,false,"B-",["Online savvy"],"The discussion boards feel like filler. The rest is solid."]
],
"Yusuf Adeyemi-Clarke":[
 ["MATH 3323","May 2026",4,3,true,"A-",["Clear grading criteria","Respected"],"Works every proof on the board instead of projecting slides. Much easier to follow than the textbook."],
 ["MATH 3323","Apr 2026",4,4,true,"B",["Test heavy","Lots of homework"],"Problem sets are graded for correctness, not completion. Start them early."],
 ["MATH 3323","Dec 2025",5,3,true,"A",["Caring","Accessible outside class"],"Stayed forty minutes past office hours to walk me through eigenvectors."],
 ["MATH 3323","Nov 2025",3,4,true,"B-",["Get ready to read"],"Moves quickly through the early chapters. Fine if you had a strong linear algebra course."],
 ["MATH 3323","May 2025",4,3,true,"B+",["Gives good feedback"],"Returns exams within a week with written comments."],
 ["MATH 3323","Apr 2025",5,3,true,"A",["Amazing lectures"],"Made matrix decompositions feel obvious. Best math course I have taken here."],
 ["MATH 3323","Dec 2024",3,4,false,"C+",["Tough grader"],"Partial credit is stingy. Show every step."],
 ["MATH 3323","Oct 2024",4,3,true,"B",["Respected"],"Solid and consistent. No surprises in either direction."]
],
"Genevieve Ostrowski":[
 ["MATH 3323","May 2026",2,5,false,"C+",["Tough grader","Test heavy","Graded by few things"],"Three exams and nothing else. Miss one and the semester is over. No partial credit."],
 ["MATH 3323","Apr 2026",3,5,false,"B-",["Get ready to read"],"Knows the material cold but does not slow down for questions. The textbook does the teaching."],
 ["MATH 3323","Dec 2025",2,5,false,"C",["Beware of pop quizzes"],"Attendance is not required but the pop quizzes make it required."],
 ["MATH 3323","Nov 2025",1,5,false,"D",["Tough grader"],"Asked a question in lecture and was told to read the chapter again. Never asked another."],
 ["MATH 3323","May 2025",3,4,true,"B",["Respected"],"Difficult but not unfair. If you want to actually learn proofs, she is the one."],
 ["MATH 3323","Apr 2025",2,5,false,"C-",["Skip class? You won't pass"],"Exams cover material never mentioned in the homework."],
 ["MATH 3323","Dec 2024",2,4,false,"C+",["Graded by few things"],"Grades posted at the end of the semester. No idea where I stood until finals."],
 ["MATH 3323","Oct 2024",4,5,true,"A-",["Inspirational"],"Hardest class I have taken and the one I learned the most in. Not for everyone."]
],
"Camille Duplantier":[
 ["ENGL 3359","May 2026",5,2,true,"A",["Gives good feedback","Clear grading criteria"],"Every assignment is something you would actually write on the job."],
 ["ENGL 3359","Apr 2026",5,3,true,"A-",["Caring","Participation matters"],"Peer review is required and she teaches you how to do it. Engineering majors do fine in here."],
 ["ENGL 3359","Dec 2025",4,3,true,"B+",["Respected"],"Marks up drafts in detail. Take the feedback seriously and your grade goes up."],
 ["ENGL 3359","Nov 2025",5,2,true,"A",["Accessible outside class"],"Reviewed my actual resume during office hours. Got the internship."],
 ["ENGL 3359","May 2025",4,3,true,"B+",["Lots of homework"],"More writing than I expected for a core class, but none of it is filler."],
 ["ENGL 3359","Apr 2025",5,2,true,"A",["Amazing lectures"],"Somehow made documentation interesting. Did not think that was possible."],
 ["ENGL 3359","Dec 2024",3,3,true,"B",["Tough grader"],"Strict on formatting. Read the style guide she posts."],
 ["ENGL 3359","Oct 2024",5,2,true,"A-",["Clear grading criteria"],"Rubric for every assignment, applied consistently."]
],
"Auggie Threlkeld":[
 ["ENGL 3359","Apr 2026",4,2,true,"A-",["Clear grading criteria"],"Straightforward course, reasonable workload, no busywork."],
 ["ENGL 3359","Mar 2026",3,3,true,"B",["Graded by few things"],"Grade comes down to four documents. Feedback is brief compared to other sections."],
 ["ENGL 3359","Dec 2025",5,2,true,"A",["Accessible outside class","Caring"],"Flexible with deadlines if you tell him ahead of time."],
 ["ENGL 3359","Nov 2025",3,2,true,"B+",["Skip class? You won't pass"],"Attendance is most of the participation grade. Lectures are skippable otherwise."],
 ["ENGL 3359","May 2025",4,3,true,"B",["Respected"],"Fine instructor. Nothing remarkable, nothing wrong."],
 ["ENGL 3359","Apr 2025",4,2,true,"A-",["Gives good feedback"],"Comments are short but useful. Turnaround is fast."],
 ["ENGL 3359","Dec 2024",2,3,false,"C+",["Tough grader"],"Vague expectations on the final report. Lost points for things never mentioned."],
 ["ENGL 3359","Oct 2024",5,2,true,"A",["Clear grading criteria"],"Easiest core requirement I have taken and I still learned something."]
],
"Nnamdi Okonkwo-Barrera":[
 ["PHYS 2421","May 2026",4,4,true,"B",["Test heavy","Lots of homework"],"Demos in every lecture help. The online homework system is the worst part of the course."],
 ["PHYS 2421","Apr 2026",4,4,true,"B+",["Respected"],"Clear explanations and he reworks the problems people miss on exams."],
 ["PHYS 2421","Dec 2025",3,5,false,"C+",["Tough grader"],"Exams are much harder than the homework. The curve is generous but the semester is stressful."],
 ["PHYS 2421","Nov 2025",5,3,true,"A-",["Amazing lectures","Caring"],"Best physics instructor I have had. Office hours are basically free tutoring."],
 ["PHYS 2421","May 2025",3,4,true,"B-",["Get ready to read"],"Assumes you are comfortable with calculus from day one."],
 ["PHYS 2421","Apr 2025",4,4,true,"B",["Clear grading criteria"],"Formula sheet provided on exams. Know how to use it."],
 ["PHYS 2421","Dec 2024",2,5,false,"C",["Skip class? You won't pass"],"The lab is a separate grade and much less organized than lecture."],
 ["PHYS 2421","Oct 2024",4,4,true,"B+",["Gives good feedback"],"Partial credit is fair. Show your work."]
],
"Delphine Aubuchon":[
 ["HIST 1302","May 2026",5,3,true,"A",["Amazing lectures","Inspirational"],"Best lecturer I have had at UTEP. Turns a required core class into something you show up for."],
 ["HIST 1302","Apr 2026",4,3,true,"B+",["Get ready to read","Clear grading criteria"],"The reading load is real but essay prompts are posted weeks ahead."],
 ["HIST 1302","Dec 2025",4,2,true,"A-",["Online savvy"],"Took the async section. Recorded lectures are the same quality as in person."],
 ["HIST 1302","Nov 2025",5,3,true,"A",["Respected","Gives good feedback"],"Comments on essays are longer than the essays. Actually useful."],
 ["HIST 1302","May 2025",3,3,true,"B",["Lots of homework"],"Weekly reading responses add up. Manageable if you do not batch them."],
 ["HIST 1302","Apr 2025",5,2,true,"A",["Caring"],"Large lecture but she learned names. No idea how."],
 ["HIST 1302","Dec 2024",4,3,true,"B+",["Test heavy"],"Two exams, both essay format. Practice writing under time pressure."],
 ["HIST 1302","Oct 2024",4,3,true,"A-",["Participation matters"],"Discussion sections count. Show up and say something."]
],
"Roland Pettibone":[
 ["HIST 1302","May 2026",2,4,false,"C+",["Graded by few things","Tough grader"],"Two essays and a final. The rubric is vague and grades came back six weeks late."],
 ["HIST 1302","Apr 2026",2,4,false,"B-",["Skip class? You won't pass","Test heavy"],"Reads from notes for eighty minutes. Exams cover lecture content that is not in the textbook."],
 ["HIST 1302","Dec 2025",3,4,false,"B",["Get ready to read"],"The material is interesting and he clearly knows it. The delivery is the problem."],
 ["HIST 1302","Nov 2025",1,4,false,"D+",["Tough grader"],"Marked me down for an argument he later made himself in lecture. No recourse."],
 ["HIST 1302","May 2025",2,3,false,"C",["Graded by few things"],"No feedback on the first essay, so no way to improve on the second."],
 ["HIST 1302","Apr 2025",3,4,true,"B+",["Respected"],"Fine if you like straight lecture and heavy reading. Some people do."],
 ["HIST 1302","Dec 2024",2,4,false,"C-",["Beware of pop quizzes"],"Surprise reading quizzes with no makeups."],
 ["HIST 1302","Oct 2024",4,3,true,"A-",["Inspirational"],"Unpopular opinion, but his lectures on Reconstruction were the best I have heard."]
]
};

const REQS = [
  { group:"Computer Science core", items:[
    { code:"CS 3350", title:"Automata, Computability & Formal Languages", cr:3 },
    { code:"CS 3432", title:"Computer Architecture I", cr:4 },
    { code:"CS 4311", title:"Software Engineering I", cr:3 },
    { code:"CS 4370", title:"Operating Systems", cr:3 }
  ]},
  { group:"Mathematics and science", items:[
    { code:"MATH 3323", title:"Matrix Algebra", cr:3 },
    { code:"PHYS 2421", title:"Introductory Mechanics", cr:4 }
  ]},
  { group:"University core curriculum", items:[
    { code:"ENGL 3359", title:"Technical Writing", cr:3 },
    { code:"HIST 1302", title:"History of the U.S. since 1865", cr:3 }
  ]},
  { group:"Unresolved requirement blocks", items:[
    { code:"CS ELEC", title:"Select 6 hours of upper-division Computer Science", cr:6,
      flag:"Action required", note:"Your audit lists this as a choose-from block. Select a specific course before it can be scheduled." }
  ]}
];

const CATALOG = {
  "CS 3350": [
    mkProf({ name:"Rosalind Vega", dept:"Computer Science", evalRaw:4.72, evalN:214,
      dist:[76,18,5,1,0], rmp:{score:4.4,diff:3.6,wta:88,n:61},
      sections:[
        {crn:"23481",days:["M","W"],start:"10:30",end:"11:50",room:"CCSB 1.0202",seats:9,cap:45,mode:"In Person"},
        {crn:"23482",days:["T","R"],start:"13:30",end:"14:50",room:"CCSB 1.0202",seats:0,cap:45,mode:"In Person"}
      ]}),
    mkProf({ name:"Desmond Ocheltree", dept:"Computer Science", evalRaw:3.91, evalN:143,
      dist:[38,29,21,9,3], rmp:{score:3.1,diff:4.4,wta:52,n:78},
      sections:[
        {crn:"23486",days:["M","W","F"],start:"09:00",end:"09:50",room:"CCSB 1.0704",seats:22,cap:45,mode:"In Person"}
      ]}),
    mkProf({ name:"Priya Raghunathan", dept:"Computer Science", evalRaw:null, evalN:0,
      dist:null, rmp:null, newHire:true,
      sections:[
        {crn:"23490",days:["T","R"],start:"16:30",end:"17:50",room:"LART 218",seats:41,cap:45,mode:"In Person"}
      ]})
  ],
  "CS 3432": [
    mkProf({ name:"Marisol Cantu-Reyes", dept:"Computer Science", evalRaw:4.86, evalN:41,
      dist:[89,9,2,0,0], rmp:{score:4.7,diff:3.2,wta:94,n:19},
      sections:[
        {crn:"24115",days:["M","W"],start:"12:00",end:"13:20",room:"ENGR 216",seats:14,cap:35,mode:"In Person"}
      ]}),
    mkProf({ name:"Hollis Brandt", dept:"Computer Science", evalRaw:4.55, evalN:96,
      dist:[64,26,8,2,0], rmp:{score:4.1,diff:4.0,wta:79,n:34},
      sections:[
        {crn:"24110",days:["T","R"],start:"09:00",end:"10:20",room:"ENGR 322",seats:6,cap:35,mode:"In Person"},
        {crn:"24111",days:["W"],start:"18:00",end:"20:50",room:"ENGR 322",seats:19,cap:35,mode:"In Person"}
      ]})
  ],
  "CS 4311": [
    mkProf({ name:"Ingrid Sallenbach", dept:"Computer Science", evalRaw:4.98, evalN:7,
      dist:[100,0,0,0,0], rmp:{score:4.9,diff:2.8,wta:100,n:5}, lowN:true,
      sections:[
        {crn:"25209",days:["T","R"],start:"11:00",end:"12:20",room:"CCSB 1.0406",seats:28,cap:40,mode:"In Person"}
      ]}),
    mkProf({ name:"Terrance Whitlock", dept:"Computer Science", evalRaw:4.31, evalN:178,
      dist:[52,31,13,3,1], rmp:{score:3.8,diff:3.9,wta:71,n:92},
      sections:[
        {crn:"25203",days:["M","W"],start:"14:00",end:"15:20",room:"CCSB 1.0406",seats:11,cap:40,mode:"In Person"}
      ]}),
    mkProf({ name:"Bo Ferreira-Lindqvist", dept:"Computer Science", evalRaw:4.12, evalN:122,
      dist:[45,32,17,5,1], rmp:{score:3.6,diff:3.4,wta:66,n:47},
      sections:[
        {crn:"25214",days:[],start:null,end:null,room:"Online, asynchronous",seats:33,cap:60,mode:"100% Online"}
      ]})
  ],
  "MATH 3323": [
    mkProf({ name:"Yusuf Adeyemi-Clarke", dept:"Mathematical Sciences", evalRaw:4.44, evalN:158,
      dist:[57,29,11,3,0], rmp:{score:4.0,diff:3.5,wta:76,n:53},
      sections:[
        {crn:"31022",days:["M","W","F"],start:"11:00",end:"11:50",room:"BELL 130",seats:17,cap:50,mode:"In Person"},
        {crn:"31025",days:["T","R"],start:"08:00",end:"09:20",room:"BELL 130",seats:31,cap:50,mode:"In Person"}
      ]}),
    mkProf({ name:"Genevieve Ostrowski", dept:"Mathematical Sciences", evalRaw:3.62, evalN:201,
      dist:[27,28,27,13,5], rmp:{score:2.7,diff:4.6,wta:39,n:114},
      sections:[
        {crn:"31030",days:["M","W"],start:"15:30",end:"16:50",room:"BELL 204",seats:38,cap:50,mode:"In Person"}
      ]})
  ],
  "ENGL 3359": [
    mkProf({ name:"Camille Duplantier", dept:"English", evalRaw:4.68, evalN:112,
      dist:[73,20,6,1,0], rmp:{score:4.5,diff:2.9,wta:91,n:38},
      sections:[
        {crn:"41560",days:["T","R"],start:"12:30",end:"13:50",room:"LART 304",seats:4,cap:25,mode:"In Person"},
        {crn:"41562",days:[],start:null,end:null,room:"Online, asynchronous",seats:12,cap:30,mode:"100% Online"}
      ]}),
    mkProf({ name:"Auggie Threlkeld", dept:"English", evalRaw:4.09, evalN:88,
      dist:[44,33,18,4,1], rmp:{score:3.9,diff:2.6,wta:74,n:22},
      sections:[
        {crn:"41571",days:["M","W"],start:"09:00",end:"10:20",room:"LART 218",seats:15,cap:25,mode:"In Person"}
      ]})
  ],
  "PHYS 2421": [
    mkProf({ name:"Nnamdi Okonkwo-Barrera", dept:"Physics", evalRaw:4.27, evalN:167,
      dist:[50,32,14,3,1], rmp:{score:3.7,diff:4.1,wta:69,n:66},
      sections:[
        {crn:"36400",days:["M","W","F"],start:"13:00",end:"13:50",room:"PSCI 205",seats:23,cap:60,mode:"In Person"}
      ]})
  ],
  "HIST 1302": [
    mkProf({ name:"Delphine Aubuchon", dept:"History", evalRaw:4.51, evalN:243,
      dist:[62,27,9,2,0], rmp:{score:4.2,diff:2.8,wta:84,n:129},
      sections:[
        {crn:"12880",days:["T","R"],start:"10:30",end:"11:50",room:"LART 111",seats:47,cap:120,mode:"In Person"},
        {crn:"12884",days:[],start:null,end:null,room:"Online, asynchronous",seats:88,cap:200,mode:"100% Online"}
      ]}),
    mkProf({ name:"Roland Pettibone", dept:"History", evalRaw:3.44, evalN:189,
      dist:[22,26,30,16,6], rmp:{score:2.4,diff:3.9,wta:31,n:97},
      sections:[
        {crn:"12891",days:["M","W"],start:"08:00",end:"09:20",room:"LART 111",seats:72,cap:120,mode:"In Person"}
      ]})
  ]
};
