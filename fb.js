// Firebase Realtime Database の関数をまとめて渡すだけのファイル（oni.js から使う）
export {getDatabase,ref,set,get,update,onValue,onDisconnect,runTransaction,serverTimestamp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
export const isLocal=false;
