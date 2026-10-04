// ISO 286-2:2010 table 1, values in micrometres, IT1..IT18.
// Source: https://cdn.standards.iteh.ai/samples/54915/7d6147c29fed4e31af36b60561e88752/ISO-286-2-2010.pdf
const bands=[3,6,10,18,30,50,80,120,180,250,315,400,500];
const grades=[
[.8,1.2,2,3,4,6,10,14,25,40,60,100,140,250,400,600,1000,1400],
[1,1.5,2.5,4,5,8,12,18,30,48,75,120,180,300,480,750,1200,1800],
[1,1.5,2.5,4,6,9,15,22,36,58,90,150,220,360,580,900,1500,2200],
[1.2,2,3,5,8,11,18,27,43,70,110,180,270,430,700,1100,1800,2700],
[1.5,2.5,4,6,9,13,21,33,52,84,130,210,330,520,840,1300,2100,3300],
[1.5,2.5,4,7,11,16,25,39,62,100,160,250,390,620,1000,1600,2500,3900],
[2,3,5,8,13,19,30,46,74,120,190,300,460,740,1200,1900,3000,4600],
[2.5,4,6,10,15,22,35,54,87,140,220,350,540,870,1400,2200,3500,5400],
[3.5,5,8,12,18,25,40,63,100,160,250,400,630,1000,1600,2500,4000,6300],
[4.5,7,10,14,20,29,46,72,115,185,290,460,720,1150,1850,2900,4600,7200],
[6,8,12,16,23,32,52,81,130,210,320,520,810,1300,2100,3200,5200,8100],
[7,9,13,18,25,36,57,89,140,230,360,570,890,1400,2300,3600,5700,8900],
[8,10,15,20,27,40,63,97,155,250,400,630,970,1550,2500,4000,6300,9700],
];
export function isoFit(nominal:number,code:string){
 const match=/^(H|h|JS|js)([1-9]|1[0-8])$/.exec(code);
 if(!match) throw new Error('Classe ainda sem tabela validada. Cálculo disponível: H, h, JS e js, graus 1–18. Use desvios manuais para as demais.');
 if(!Number.isFinite(nominal)||nominal<=0||nominal>500) throw new Error('Faixa validada: acima de 0 até 500 mm.');
 const band=bands.findIndex(limit=>nominal<=limit),it=grades[band][Number(match[2])-1]/1000;
 const lower=match[1]==='H'?0:match[1]==='h'?-it:-it/2;
 const upper=match[1]==='H'?it:match[1]==='h'?0:it/2;
 return {code,lower,upper,minimum:nominal+lower,maximum:nominal+upper};
}
