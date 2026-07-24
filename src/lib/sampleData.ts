import type { SalonData } from '../types'
import { createMonogramImage } from './image'

const now = new Date().toISOString()
export const seededData: SalonData = {
  clients: [
    { id:'c1', firstName:'Ana', lastName:'Kovačević', phone:'0981234567', photo:createMonogramImage('AK','warm'), note:'Osjetljivo vlasište. Voli prirodan volumen i boju meda.', createdAt:now, updatedAt:now },
    { id:'c2', firstName:'Marta', lastName:'Rukavina', phone:'0913344556', photo:createMonogramImage('MR','soft'), note:'Termin obično subotom prije podne.', createdAt:now, updatedAt:now },
    { id:'c3', firstName:'Ivana', lastName:'Perić', phone:'0952221144', photo:createMonogramImage('IP','warm'), note:'Priprema frizure za svadbu 2026-08-12.', createdAt:now, updatedAt:now },
  ],
  appointments: [
    { id:'a1', clientId:'c1', dateTime:'2026-07-25T09:30:00', service:'Pramenovi + fen frizura', status:'zakazan', note:'Bez jakih mirisa.', assignedBy:'Kristina', createdAt:now, updatedAt:now },
    { id:'a2', clientId:'c2', dateTime:'2026-07-25T12:00:00', service:'Šišanje i toniranje', status:'zakazan', note:'', assignedBy:'Kristina', createdAt:now, updatedAt:now },
    { id:'a3', clientId:'c3', dateTime:'2026-07-26T16:30:00', service:'Probna svečana frizura', status:'otkazan', note:'Termin probe je pomaknut.', assignedBy:'Kristina', createdAt:now, updatedAt:now },
  ],
  messages: [
    { id:'m1', clientId:'c1', senderName:'Ana Kovačević', senderPhone:'0981234567', text:'Možemo li na terminu dodati i masku za obnovu?', createdAt:'2026-07-24T18:05:00', read:false },
    { id:'m2', clientId:'c2', senderName:'Marta Rukavina', senderPhone:'0913344556', text:'Kasnit ću oko 10 minuta, javim kad krenem.', createdAt:'2026-07-24T11:20:00', read:true },
  ],
  hairstyles: [
    { id:'h1', clientId:'c1', date:'2026-06-20', before:createMonogramImage('PRIJE','soft'), after:createMonogramImage('POSLIJE','warm'), note:'Mekani slojevi i hladniji ton pepeljasto-plave.', visibleToClient:true, createdAt:now },
    { id:'h2', clientId:'c3', date:'2026-07-10', before:createMonogramImage('PRIJE','soft'), after:createMonogramImage('POSLIJE','warm'), note:'Svečana punđa s laganim volumenom.', createdAt:now },
  ],
}
