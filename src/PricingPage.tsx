import { officialPrices, formatPrice } from './lib/officialPrices'
import './Portal.css'

interface PricingPageProps {
  onClose: () => void
}


export function PricingPage({onClose}: PricingPageProps) {
  return <main className="access-page"><section className="access-card" style={{width:'min(96vw,1100px)',maxWidth:'1100px'}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'12px',marginBottom:'20px'}}><div><h1>Cjenik frizerskih usluga</h1><p style={{color:'var(--muted)',fontSize:'13px'}}>Frizerski salon Kristina · Školska 18, Pušćine</p></div><button type="button" onClick={onClose} aria-label="Zatvori cjenik" style={{background:'transparent',border:0,fontSize:'24px',cursor:'pointer'}}>✕</button></div>
    <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',minWidth:'690px',fontSize:'13px'}}><thead><tr>{[0,1].map(side=><th key={side} colSpan={3} style={{textAlign:'left',padding:'8px 6px',borderBottom:'1px solid var(--line)'}}>Usluga <span style={{float:'right'}}>Bazna 10. 9. 2026. / Aktualna 15. 11. 2026.</span></th>)}</tr></thead><tbody>{officialPrices.slice(0,32).map((left,index)=>{const right=officialPrices[index+32];return <tr key={left.name} style={{borderBottom:'1px solid var(--line)'}}>{[left,right].map(item=><td key={item.name} colSpan={3} style={{padding:'8px 6px'}}><div style={{display:'grid',gridTemplateColumns:'minmax(110px,1fr) auto auto',gap:'10px',alignItems:'center'}}><span>{item.name}</span><span style={{whiteSpace:'nowrap'}}>{formatPrice(item.base)}</span><strong style={{whiteSpace:'nowrap'}}>{formatPrice(item.current)}</strong></div></td>)}</tr>})}</tbody></table></div>
    <p style={{fontSize:'12px',color:'var(--muted)'}}>Cijene u eurima. Bazna cijena vrijedi na dan 10. 9. 2026.</p><button className="link" onClick={onClose}>Natrag</button>
  </section></main>
}
